// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {stdJson} from "forge-std/StdJson.sol";

/**
 * The one address file every tool reads: deployments/<chainId>.json at the repository root.
 *
 *   {
 *     "chainId": 4663,
 *     "startBlock": 123,             first block of the deploy (log scans start here)
 *     "deployer": "0x...", "owner": "0x...",
 *     "inputs":    { "PAPER": "0x...", "PLANK": "0x...", ... },        what the deploy was given (.env)
 *     "contracts": { "PlankUsdTwap": "0x...", "FireCards": "0x...", ... }   what it deployed
 *   }
 *
 * Read by ConfigureSeries, VerifyDeploy, VerifySeries (ops/series), the keeper (ops/keeper), ops/snapshot and the
 * site (web/src/lib/config.ts). DEPLOYMENTS_FILE points every tool at another file (rehearsals).
 *
 * How it gets written: forge runs a script's code BEFORE it broadcasts anything (and a broadcast can still fail or
 * stop half way), so a script never writes the file itself. DeployTwap, DeployInfra, DeployCards and DevStack write
 * what they mean to record to `<file>.pending` (only with --broadcast); after the broadcast,
 *   node ops/deploy/record.mjs --rpc <RPC>
 * checks every new address against the broadcast receipts (contracts/broadcast/<script>/<chainId>/run-latest.json)
 * and the chain (code at each one), then merges it into the file and removes the .pending one. Run VerifyDeploy
 * before committing the file.
 */
abstract contract Deployments is Script {
    using stdJson for string;

    /// Every contract name the file can hold, in the order it is written.
    function _contractNames() internal pure returns (string[15] memory) {
        return [
            "PlankUsdTwap", "OpenDrandRouter", "PaperUsdTwap", "FirePacks", "FireCards", "CardsRenderer", "RecipeDealer",
            "RecipeCompiler", "PlankBurner", "FireCredits", "FireSale", "PaperBurner", "FirePsa", "CardsAdapter", "PsaAdapter"
        ];
    }

    /// Every input name the file can hold (the .env settings that are addresses).
    function _inputNames() internal pure returns (string[12] memory) {
        return [
            "PAPER", "PLANK", "USDG", "WETH", "MILL", "ETH_USD_FEED", "PLANK_WETH_V2_PAIR", "UNIV2_FACTORY", "V2_ROUTER",
            "REVENUE_WALLET", "ROYALTY_RECEIVER", "OWNER"
        ];
    }

    function deploymentsFile() public view returns (string memory) {
        return vm.envOr(
            "DEPLOYMENTS_FILE", string.concat(vm.projectRoot(), "/../deployments/", vm.toString(block.chainid), ".json")
        );
    }

    /// The file's contents ("{}" when it doesn't exist yet).
    function _deploymentsJson() internal view returns (string memory) {
        string memory path = deploymentsFile();
        if (!vm.exists(path)) return "{}";
        return vm.readFile(path);
    }

    /// A deployed contract's address from the file (address(0) if absent).
    function deployed(string memory name) public view returns (address) {
        return _deploymentsJson().readAddressOr(string.concat(".contracts.", name), address(0));
    }

    /// An input's address from the file (address(0) if absent).
    function deployedInput(string memory name) public view returns (address) {
        return _deploymentsJson().readAddressOr(string.concat(".inputs.", name), address(0));
    }

    /// `envName` from the environment, else `fileName` from the deployments file; reverts naming both if neither is set.
    function _addr(string memory envName, string memory fileName) internal view returns (address a) {
        a = vm.envOr(envName, address(0));
        if (a == address(0)) a = deployed(fileName);
        require(a != address(0), string.concat("set ", envName, " or deploy ", fileName, " first (deployments file: ", deploymentsFile(), ")"));
    }

    /// Where a script leaves what it means to record, for ops/deploy/record.mjs to check and merge after the broadcast.
    function pendingFile() public view returns (string memory) {
        return string.concat(deploymentsFile(), ".pending");
    }

    function _writing() internal view returns (bool) {
        return vm.isContext(VmSafe.ForgeContext.ScriptBroadcast) || vm.isContext(VmSafe.ForgeContext.ScriptResume);
    }

    /// Merge `names`/`addrs` (contracts) and `inNames`/`inAddrs` (inputs) with the file and write the result to
    /// pendingFile(), when broadcasting (never the file itself: see the top of this file).
    function _record(
        string[] memory names,
        address[] memory addrs,
        string[] memory inNames,
        address[] memory inAddrs,
        address owner,
        address deployer
    ) internal {
        if (!_writing()) return;
        // an earlier broadcast not yet recorded (or one that failed): sort it out first, or it would be overwritten
        require(
            vm.isContext(VmSafe.ForgeContext.ScriptResume) || !vm.exists(pendingFile()),
            string.concat(pendingFile(), " is waiting: run node ops/deploy/record.mjs first (delete it if that broadcast failed)")
        );
        string memory old = _deploymentsJson();
        string memory c = "contracts";
        string memory cj = "{}";
        string[15] memory cn = _contractNames();
        for (uint256 i; i < cn.length; i++) {
            address a = old.readAddressOr(string.concat(".contracts.", cn[i]), address(0));
            for (uint256 k; k < names.length; k++) if (keccak256(bytes(names[k])) == keccak256(bytes(cn[i]))) a = addrs[k];
            if (a != address(0)) cj = vm.serializeAddress(c, cn[i], a);
        }
        string memory n = "inputs";
        string memory ij = "{}";
        string[12] memory inn = _inputNames();
        for (uint256 i; i < inn.length; i++) {
            address a = old.readAddressOr(string.concat(".inputs.", inn[i]), address(0));
            for (uint256 k; k < inNames.length; k++) if (keccak256(bytes(inNames[k])) == keccak256(bytes(inn[i]))) a = inAddrs[k];
            if (a != address(0)) ij = vm.serializeAddress(n, inn[i], a);
        }
        string memory r = "root";
        vm.serializeUint(r, "chainId", block.chainid);
        vm.serializeUint(r, "startBlock", old.readUintOr(".startBlock", block.number));
        address d = old.readAddressOr(".deployer", deployer);
        if (d != address(0)) vm.serializeAddress(r, "deployer", d);
        address o = owner != address(0) ? owner : old.readAddressOr(".owner", address(0));
        if (o != address(0)) vm.serializeAddress(r, "owner", o);
        vm.serializeString(r, "inputs", ij);
        string memory out = vm.serializeString(r, "contracts", cj);
        vm.writeJson(out, pendingFile());
        console.log(string.concat("after the broadcast: node ops/deploy/record.mjs --rpc <RPC>  (records ", pendingFile(), ")"));
    }

    // small helpers for building the lists
    function _one(string memory a) internal pure returns (string[] memory s) {
        s = new string[](1);
        s[0] = a;
    }

    function _oneA(address a) internal pure returns (address[] memory s) {
        s = new address[](1);
        s[0] = a;
    }
}
