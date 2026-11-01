// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {console} from "forge-std/Script.sol";
import {IERC1155} from "openzeppelin-contracts/contracts/token/ERC1155/IERC1155.sol";
import {Deployments} from "./Deployments.sol";
import {DevToken, DevKit} from "./dev/DevContracts.sol";
import {FireSale} from "../src/cards/FireSale.sol";
import {FireGroups} from "../src/cards/FireGroups.sol";

/**
 * Testnet only: fill the test kit with sealed packs testers can open straight away. Buys out the warm-up Series (the
 * studio's "Testnet warm-up" sale: one open group, 40 packs), closes it (sold out, so its packs can open), sends every
 * pack to the test kit (DevKit, TESTKIT) and sets it to hand out PER (default 2) per wallet. Pays in test USDG and
 * test PAPER it mints itself, so run it from the wallet that ran DevStack (it owns the stand-ins and the kit), after
 * the warm-up's start.
 *
 *   $env:FIRE = 1; forge script script/WarmUp.s.sol --rpc-url $env:RPC --account testnet-deployer --sender $DEPLOYER --slow --broadcast
 */
contract WarmUpScript is Deployments {
    function run() external {
        require(block.chainid != 4663, "WarmUp: never on Robinhood Chain mainnet (4663)");
        require(block.chainid == vm.envOr("EXPECTED_CHAIN_ID", uint256(46630)), "WarmUp: not the testnet (46630)");
        uint256 fire = vm.envOr("FIRE", uint256(1));
        uint256 per = vm.envOr("PER", uint256(2));
        FireSale sale = FireSale(payable(deployed("FireSale")));
        DevKit kit = DevKit(deployedInput("TESTKIT"));
        IERC1155 packs = IERC1155(deployed("FirePacks"));
        require(address(kit) != address(0), "WarmUp: no test kit (TESTKIT): run DevStack first");
        require(address(sale) != address(0), "WarmUp: deploy the card contracts first (FireSale)");
        FireSale.Drop memory d = sale.dropOf(fire);
        require(d.start != 0 && !d.closed, "WarmUp: that Series has no drop on sale (launch the warm-up first)");
        require(block.timestamp >= d.start, "WarmUp: the warm-up hasn't started yet (wait for its start)");

        vm.startBroadcast();
        _buyOut(sale, fire, d.maxPerTx);
        if (!sale.dropOf(fire).closed) sale.close(fire); // the last pack usually closes it already
        uint256 bought = packs.balanceOf(msg.sender, fire);
        packs.safeTransferFrom(msg.sender, address(kit), fire, bought, "");
        kit.setPacks(packs, fire, per);
        vm.stopBroadcast();

        console.log(string.concat("warm-up Series ", vm.toString(fire), " bought out and closed; ", vm.toString(bought),
            " sealed packs in the test kit, ", vm.toString(per), " per wallet"));
    }

    /// Every pack left, in test USDG and test PAPER minted for it (the deployer owns the stand-ins).
    function _buyOut(FireSale sale, uint256 fire, uint256 perTx) internal {
        FireGroups groups = FireGroups(deployed("FireGroups"));
        uint256 group = vm.envOr("GROUP", uint256(0));
        uint256 left = groups.remaining(fire);
        while (left > 0) {
            uint256 n = left < perTx ? left : perTx;
            _buy(sale, fire, group, n);
            left -= n;
        }
    }

    function _buy(FireSale sale, uint256 fire, uint256 group, uint256 n) internal {
        DevToken paper = DevToken(deployedInput("PAPER"));
        DevToken usdg = DevToken(deployedInput("USDG"));
        (uint256 cost, uint256 paperCost) = sale.quote(fire, group, n, FireSale.Pay.USDG);
        usdg.mint(msg.sender, cost);
        paper.mint(msg.sender, paperCost);
        usdg.approve(address(sale), cost);
        paper.approve(address(sale), paperCost);
        FireGroups.Access memory none;
        sale.buy(fire, group, n, FireSale.Pay.USDG, cost, paperCost, none);
    }
}
