// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {FirePacks} from "../src/cards/FirePacks.sol";
import {FireCards} from "../src/cards/FireCards.sol";
import {OpenVRFAdapter} from "../src/OpenVRFAdapter.sol";

/**
 * Deploys the Omni card contracts (see ../docs/cards-contracts.md): FirePacks + FireCards + a drand adapter pointed at
 * FireCards. Checks every input before sending anything.
 *
 *   forge script script/DeployCards.s.sol --rpc-url $RPC --account deployer --sender <deployer address> --slow --broadcast \
 *     --verify --verifier blockscout --verifier-url https://robinhoodchain.blockscout.com/api/
 *
 * Sign with a Foundry keystore (cast wallet import deployer --interactive) or --ledger. Never --private-key.
 *
 * DRAND_ROUTER     = the OpenDrandRouter already on chain (shared with the Fire; it has no owner).
 * OWNER            = the multisig (Safe) that will own both contracts. It must ACCEPT ownership afterwards
 *                    (Ownable2Step: call acceptOwnership() on FirePacks and FireCards from the Safe). Until then the
 *                    deployer is still the owner. A plain wallet is refused unless ALLOW_EOA_OWNER=true.
 * ROYALTY_RECEIVER = where resale royalties go (the multisig or a splitter). ROYALTY_BPS = e.g. 500 (5%), max 1000.
 * PACK_IMAGE_BASE  = folder of the pack art, e.g. ipfs://<CID>/ (holds fire<N>.webp). Can be set later by the owner.
 *
 * Left for later, by the owner: setSeller on both contracts once the pack sale contract exists (it mints packs and
 * closes Fires), and configureFire for each Fire.
 */
contract DeployCards is Script {
    struct Deployed {
        FirePacks packs;
        FireCards cards;
        OpenVRFAdapter adapter;
    }

    function run() external returns (Deployed memory d) {
        address router = vm.envAddress("DRAND_ROUTER");
        address owner = vm.envAddress("OWNER");
        address royaltyTo = vm.envAddress("ROYALTY_RECEIVER");
        uint256 bps = vm.envUint("ROYALTY_BPS");
        string memory packBase = vm.envOr("PACK_IMAGE_BASE", string(""));
        _check(router, owner, royaltyTo, bps);

        vm.startBroadcast();
        d = deploy(router, owner, royaltyTo, uint96(bps), packBase, msg.sender);
        vm.stopBroadcast();

        console.log("FirePacks ", address(d.packs));
        console.log("FireCards ", address(d.cards));
        console.log("Adapter   ", address(d.adapter));
        console.log("Next: the OWNER multisig calls acceptOwnership() on FirePacks and FireCards.");
    }

    /// @dev Split out so tests can run the exact same steps.
    function deploy(address router, address owner, address royaltyTo, uint96 bps, string memory packBase, address deployer)
        public
        returns (Deployed memory d)
    {
        d.packs = new FirePacks(deployer);
        d.cards = new FireCards(deployer, address(d.packs));
        d.adapter = new OpenVRFAdapter(router, address(d.cards));
        require(d.adapter.FIRE() == address(d.cards), "adapter points elsewhere");

        d.packs.setCards(address(d.cards));
        d.cards.setRandomness(address(d.adapter));
        d.packs.setDefaultRoyalty(royaltyTo, bps);
        d.cards.setDefaultRoyalty(royaltyTo, bps);
        if (bytes(packBase).length > 0) d.packs.setPackImageBase(packBase);

        d.packs.transferOwnership(owner);
        d.cards.transferOwnership(owner);
    }

    function _check(address router, address owner, address royaltyTo, uint256 bps) internal view {
        require(router.code.length > 0, "DRAND_ROUTER has no code on this chain");
        require(owner != address(0) && royaltyTo != address(0), "OWNER / ROYALTY_RECEIVER missing");
        require(owner.code.length > 0 || vm.envOr("ALLOW_EOA_OWNER", false), "OWNER should be a multisig (set ALLOW_EOA_OWNER=true to override)");
        require(bps <= 1000, "ROYALTY_BPS above 10%");
    }
}
