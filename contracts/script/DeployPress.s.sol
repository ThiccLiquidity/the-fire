// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {console} from "forge-std/Script.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {Deployments} from "./Deployments.sol";
import {MorningWood} from "../src/press/MorningWood.sol";

interface IPressFeedInfo {
    function decimals() external view returns (uint8);
}

/**
 * The Morning Wood (docs/morning-wood.md): the daily paper's ERC-1155, on its own. Wired to what's already deployed:
 * PAPER, USDG and ETH_USD_FEED (the inputs) and PaperBurner (the contracts) from deployments/<chainId>.json, or the
 * same names in the environment.
 *
 *   $env:EDITOR = "<editor address>"     (cast wallet address --account editor)
 *   forge script script/DeployPress.s.sol:DeployPress --rpc-url $env:RPC --account deployer --sender <deployer address> --slow --broadcast \
 *     --verify --verifier blockscout --verifier-url https://robinhoodchain.blockscout.com/api/
 *   node ..\ops\deploy\record.mjs --rpc $env:RPC        (adds "MorningWood" to the deployments file)
 *   forge script script/DeployPress.s.sol:AcceptPress --rpc-url $env:RPC --ledger --hd-paths $env:OWNER_HD_PATH --sender $env:OWNER --slow --broadcast
 *
 * The file holds two scripts, so always name the one to run (":DeployPress" / ":AcceptPress"), or forge refuses
 * ("Multiple contracts in the target path").
 *
 * Testnet: EXPECTED_CHAIN_ID=46630 (Robinhood Chain testnet), deployments/46630.json is read.
 *
 * Settings:
 *   OWNER             takes over after the deploy (two steps: AcceptPress below, signed on the hardware wallet).
 *                     Read from the deployments file when not set. Must not be the deployer.
 *   EDITOR            the nightly pipeline's key (Foundry keystore "editor"): it can only publish issues, at least an
 *                     hour before they open (the owner's time to veto). Optional; the owner can set it later (setEditor).
 *   ROYALTY_RECEIVER  2.5% royalty (setRoyalty later, max 10%). Read from the deployments file when not set.
 *   PRESS_CONTRACT_URI  collection metadata (optional).
 *
 * PaperBurner needs no change: the press only sends ETH/USDG to it (receive() / a plain transfer), like FireSale, and
 * the keeper's regular flush (ops/keeper) buys and burns PAPER with whatever it holds. The press is not a flusher.
 */
contract DeployPress is Deployments {
    using stdJson for string;

    struct Params {
        address paper;
        address usdg;
        address ethUsd;
        address burner;
        address owner;
        address royaltyTo;
        address editor; // 0 = set later
        string contractUri; // "" = none
    }

    function run() external returns (MorningWood press) {
        require(block.chainid == vm.envOr("EXPECTED_CHAIN_ID", uint256(4663)), "not Robinhood Chain (4663; EXPECTED_CHAIN_ID=46630 for testnet)");
        require(deployed("MorningWood") == address(0) || vm.envOr("REPLACE_PRESS", false),
            "MorningWood is already in the deployments file (REPLACE_PRESS=true for a new one)");
        Params memory p = Params({
            paper: _in("PAPER"),
            usdg: _in("USDG"),
            ethUsd: _in("ETH_USD_FEED"),
            burner: _addr("PAPER_BURNER", "PaperBurner"),
            owner: vm.envOr("OWNER", deployedInput("OWNER")),
            royaltyTo: vm.envOr("ROYALTY_RECEIVER", deployedInput("ROYALTY_RECEIVER")),
            editor: vm.envOr("EDITOR", address(0)),
            contractUri: vm.envOr("PRESS_CONTRACT_URI", string(""))
        });
        press = deploy(p);
        console.log("MorningWood", address(press));
        console.log("editor", p.editor);
        console.log("Next: the OWNER accepts: forge script script/DeployPress.s.sol:AcceptPress --rpc-url <RPC> --ledger --hd-paths <OWNER_HD_PATH> --sender <owner> --slow --broadcast");
        _recordPress(address(press));
    }

    /// Checks the inputs, deploys as the sender (the throwaway deployer), wires it and hands it to the owner.
    function deploy(Params memory p) public returns (MorningWood press) {
        require(p.owner != address(0) && p.royaltyTo != address(0), "OWNER / ROYALTY_RECEIVER missing");
        require(p.owner != msg.sender, "OWNER is the deployer: use a throwaway deployer and the hardware wallet as OWNER");
        require(p.paper.code.length > 0 && p.usdg.code.length > 0 && p.burner.code.length > 0, "PAPER / USDG / PaperBurner have no code");
        require(IPressFeedInfo(p.ethUsd).decimals() == 8, "ETH_USD_FEED must have 8 decimals");

        vm.startBroadcast(msg.sender); // --sender: the deployer owns it until the hand-over below
        press = new MorningWood(msg.sender, p.paper, p.usdg, p.burner, p.ethUsd, p.royaltyTo);
        if (p.editor != address(0)) press.setEditor(p.editor);
        if (bytes(p.contractUri).length != 0) press.setContractURI(p.contractUri);
        press.transferOwnership(p.owner);
        vm.stopBroadcast();

        require(address(press.PAPER()) == p.paper && press.paperBurner() == p.burner && address(press.ethUsd()) == p.ethUsd, "press wiring");
        require(press.pendingOwner() == p.owner, "press owner hand-over");
    }

    function _in(string memory name) internal view returns (address a) {
        a = vm.envOr(name, deployedInput(name));
        require(a != address(0), string.concat("set ", name, " (or add it to the deployments file's inputs)"));
    }

    /// Deployments._record only knows the card contracts, so this writes a pending file with just MorningWood;
    /// ops/deploy/record.mjs merges it into the deployments file like any other.
    function _recordPress(address press) internal {
        if (!_writing()) return;
        require(!vm.exists(pendingFile()), string.concat(pendingFile(), " is waiting: run node ops/deploy/record.mjs first"));
        string memory c = vm.serializeAddress("pressContracts", "MorningWood", press);
        vm.serializeUint("pressRoot", "chainId", block.chainid);
        vm.serializeString("pressRoot", "inputs", "{}");
        string memory out = vm.serializeString("pressRoot", "contracts", c);
        vm.writeJson(out, pendingFile());
        console.log(string.concat("after the broadcast: node ops/deploy/record.mjs --rpc <RPC>  (records ", pendingFile(), ")"));
    }
}

/// The owner (hardware wallet) takes over MorningWood after DeployPress. Dry run without --broadcast.
contract AcceptPress is Deployments {
    function run() external {
        address owner = vm.envOr("OWNER", deployedInput("OWNER"));
        address press = vm.envOr("MORNING_WOOD", deployed("MorningWood"));
        require(press != address(0) && press.code.length > 0, "MorningWood not deployed (or set MORNING_WOOD)");
        require(msg.sender == owner, "sign as the owner: --ledger (or --trezor) --sender <it>");
        if (MorningWood(press).owner() == owner) return console.log("The owner already holds MorningWood.");
        require(MorningWood(press).pendingOwner() == owner, "MorningWood is not waiting for this owner");
        vm.startBroadcast(owner);
        MorningWood(press).acceptOwnership();
        vm.stopBroadcast();
        console.log("accepted", press);
    }
}
