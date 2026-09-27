// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {Test} from "forge-std/Test.sol";
import {Fire, ISeaport} from "../src/Fire.sol";
import {MockERC20, MockUSDG, MockMill, MockFeed, MockRandomness} from "./Mocks.sol";

interface ISeaportFull {
    struct OrderComponents { address offerer; address zone; ISeaport.OfferItem[] offer; ISeaport.ConsiderationItem[] consideration; uint8 orderType; uint256 startTime; uint256 endTime; bytes32 zoneHash; uint256 salt; bytes32 conduitKey; uint256 counter; }
    function getOrderHash(OrderComponents calldata) external view returns (bytes32);
    function information() external view returns (string memory, bytes32, address);
}

/// Fire's mill purchase against Seaport 1.6's real code (bytecode in test/vendor/seaport, see its README).

/// A zone that approves only when the fulfiller passed our marker as extraData (stands in for OpenSea's SignedZone).
contract MarkerZone {
    bytes32 constant MARKER = keccak256("opensea-signed-zone-data");
    uint256 public calls;
    fallback(bytes calldata data) external returns (bytes memory) {
        bool found;
        for (uint256 i; i + 32 <= data.length; i++) { if (bytes32(data[i:i + 32]) == MARKER) { found = true; break; } }
        require(found, "zone: missing extraData");
        calls++;
        return abi.encode(msg.sig); // authorizeOrder / validateOrder magic value
    }
}

contract RealSeaportTest is Test {
    string constant VENDOR = "test/vendor/seaport/";
    ISeaportFull sea; Fire fire; MockMill mill; MockERC20 plank; MockUSDG usdg; MarkerZone zone;
    uint256 aliceKey = 0xA11CE; address alice; address osFee = address(0x05ea0feE000000000000000000000000000fEE01); address royalty = address(0xB0B);

    function setUp() public {
        vm.warp(1_800_000_000);
        alice = vm.addr(aliceKey);
        address cc = _deploy(vm.parseBytes(vm.readFile(string.concat(VENDOR, "ConduitController.hex"))));
        sea = ISeaportFull(_deploy(abi.encodePacked(vm.parseBytes(vm.readFile(string.concat(VENDOR, "Seaport.hex"))), abi.encode(cc))));
        plank = new MockERC20("PLANK", "PLANK");
        usdg = new MockUSDG();
        mill = new MockMill(address(plank), 88_842_006_942e18);
        MockRandomness rng = new MockRandomness();
        fire = new Fire(Fire.Config({paper: address(new MockERC20("PAPER", "PAPER")), plank: address(plank), mill: address(mill), seaport: address(sea),
            royaltyPool: royalty, randomness: address(rng), ethUsdFeed: address(new MockFeed(3_333_00000000)), plankUsdFeed: address(new MockFeed(90_000_000_000)), usdg: address(usdg),
            paperPerTicket: 1e18, plankPerTicket0: 1e25, plankUsdPerTicket: 90_000_000, ethUsdPerTicket: 100_000_000, millBidBase: 100e8, rollTimeOfDay: 10800}));
        vm.deal(address(fire), 1 ether);
        zone = new MarkerZone();
        plank.mint(alice, 1e30);
        vm.startPrank(alice); plank.approve(address(mill), type(uint256).max); mill.setApprovalForAll(address(sea), true); vm.stopPrank();
    }

    function _deploy(bytes memory code) internal returns (address a) {
        assembly { a := create(0, add(code, 0x20), mload(code)) }
        require(a != address(0), "deploy failed");
    }

    /// An OpenSea-shaped listing: price to the seller, a fee item to OpenSea, signed by the seller (EIP-712).
    function _listing(uint256 id, uint256 toSeller, uint256 fee, uint8 orderType, address z) internal view returns (ISeaport.Order memory o) {
        return _listingIn(address(0), id, toSeller, fee, orderType, z);
    }

    function _listingIn(address currency, uint256 id, uint256 toSeller, uint256 fee, uint8 orderType, address z) internal view returns (ISeaport.Order memory o) {
        uint8 t = currency == address(0) ? 0 : 1;
        ISeaport.OfferItem[] memory offer = new ISeaport.OfferItem[](1);
        offer[0] = ISeaport.OfferItem(2, address(mill), id, 1, 1);
        ISeaport.ConsiderationItem[] memory cons = new ISeaport.ConsiderationItem[](2);
        cons[0] = ISeaport.ConsiderationItem(t, currency, 0, toSeller, toSeller, payable(alice));
        cons[1] = ISeaport.ConsiderationItem(t, currency, 0, fee, fee, payable(osFee));
        ISeaportFull.OrderComponents memory c = ISeaportFull.OrderComponents(alice, z, offer, cons, orderType, block.timestamp - 1, block.timestamp + 1 days, bytes32(0), 42, bytes32(0), 0);
        (, bytes32 domain,) = sea.information();
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(aliceKey, keccak256(abi.encodePacked(hex"1901", domain, sea.getOrderHash(c))));
        o.parameters = ISeaport.OrderParameters(alice, z, offer, cons, orderType, c.startTime, c.endTime, bytes32(0), 42, bytes32(0), 2);
        o.signature = abi.encodePacked(r, s, v);
    }

    function test_real_seaport_open_listing() public {
        vm.prank(alice); uint256 id = mill.mint(alice);
        uint256 a0 = alice.balance;
        fire.eatMillFromSeaport(_listing(id, 0.0195 ether, 0.0005 ether, 0, address(0)), "");
        assertEq(alice.balance - a0, 0.0195 ether, "seller paid");
        assertEq(osFee.balance, 0.0005 ether, "OpenSea fee paid");
        assertEq(address(fire).balance, 1 ether - 0.02 ether - 0.0003 ether, "fund paid price + burn fee, nothing else");
        assertEq(plank.balanceOf(royalty), 88_842_006_942e18, "mill's PLANK to the pool");
        vm.expectRevert(); mill.ownerOf(id);
        assertEq(fire.millBid(), 0.02 ether * 3_333_00000000 / 1e18 * 9_000 / 10_000, "bid restarts at 90% of the price, in dollars");
    }

    function test_real_seaport_restricted_listing_needs_and_gets_zone_data() public {
        vm.prank(alice); uint256 id = mill.mint(alice);
        ISeaport.Order memory o = _listing(id, 0.0195 ether, 0.0005 ether, 2, address(zone)); // FULL_RESTRICTED
        vm.expectRevert(); // no zone data -> the zone refuses
        fire.eatMillFromSeaport(o, "");
        fire.eatMillFromSeaport(o, abi.encode(keccak256("opensea-signed-zone-data")));
        assertGt(zone.calls(), 0, "zone was consulted");
        vm.expectRevert(); mill.ownerOf(id);
    }

    function test_real_seaport_usdg_listing() public {
        usdg.mint(address(fire), 200e6);
        vm.prank(alice); uint256 id = mill.mint(alice);
        uint256 eth0 = address(fire).balance;
        fire.eatMillFromSeaport(_listingIn(address(usdg), id, 97.5e6, 2.5e6, 0, address(0)), ""); // $100 listing, like the ones live now
        assertEq(usdg.balanceOf(alice), 97.5e6, "seller paid in USDG");
        assertEq(usdg.balanceOf(osFee), 2.5e6, "OpenSea fee paid in USDG");
        assertEq(usdg.balanceOf(address(fire)), 100e6);
        assertEq(eth0 - address(fire).balance, 0.0003 ether, "only the burn fee in ETH");
        assertEq(usdg.allowance(address(fire), address(sea)), 0);
        vm.expectRevert(); mill.ownerOf(id);
    }

    function test_real_seaport_bad_signature_fails_cleanly() public {
        vm.prank(alice); uint256 id = mill.mint(alice);
        ISeaport.Order memory o = _listing(id, 0.0195 ether, 0.0005 ether, 0, address(0));
        o.parameters.consideration[0].endAmount = 0.001 ether; // tamper: cheaper than signed
        o.parameters.consideration[0].startAmount = 0.001 ether;
        vm.expectRevert();
        fire.eatMillFromSeaport(o, "");
        assertEq(address(fire).balance, 1 ether, "fund untouched");
    }
}
