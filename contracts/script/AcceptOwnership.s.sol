// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {console} from "forge-std/Script.sol";
import {Deployments} from "./Deployments.sol";

interface IOwnable2Step {
    function owner() external view returns (address);
    function pendingOwner() external view returns (address);
    function acceptOwnership() external;
}

/**
 * The owner (one hardware wallet) takes over the six contracts DeployCards handed it (docs/deploy.md, step 4):
 * acceptOwnership() on FirePacks, FireCards, RecipeDealer, FireCredits, FirePsa and PaperBurner. FireSale is the
 * owner's from deployment; PlankBurner has no owner. Addresses and the expected owner come from
 * deployments/<chainId>.json. Contracts the owner already holds are skipped, so it can be run again.
 *
 *   forge script script/AcceptOwnership.s.sol --rpc-url $env:RPC --ledger --sender <owner address> --slow --broadcast
 *
 * (--trezor instead of --ledger; add --mnemonic-indexes <n> if the owner isn't the device's first account.) Without
 * --broadcast it is a dry run. It refuses unless the signer is the owner the deploy recorded.
 */
contract AcceptOwnership is Deployments {
    function owned() public pure returns (string[6] memory) {
        return ["FirePacks", "FireCards", "RecipeDealer", "FireCredits", "FirePsa", "PaperBurner"];
    }

    /// @notice The contracts still waiting for `owner` to accept. Reverts if one is pending to someone else.
    function toAccept(address owner) public view returns (address[] memory list) {
        string[6] memory names = owned();
        list = new address[](names.length);
        uint256 n;
        for (uint256 i; i < names.length; i++) {
            address c = deployed(names[i]);
            require(c != address(0) && c.code.length > 0, string.concat(names[i], " is not in the deployments file (deploy first)"));
            IOwnable2Step o = IOwnable2Step(c);
            if (o.owner() == owner) continue;
            require(o.pendingOwner() == owner, string.concat(names[i], " is not waiting for this owner"));
            list[n++] = c;
        }
        assembly {
            mstore(list, n)
        }
    }

    function run() external {
        address owner = vm.envOr("OWNER", deployedInput("OWNER"));
        require(owner != address(0), "no owner in the deployments file (set OWNER)");
        require(msg.sender == owner, string.concat("sign as the owner ", vm.toString(owner), ": --ledger (or --trezor) --sender <it>"));
        address[] memory list = toAccept(owner);
        if (list.length == 0) {
            console.log("Nothing to accept: the owner already holds all six.");
            return;
        }
        vm.startBroadcast(owner);
        for (uint256 i; i < list.length; i++) IOwnable2Step(list[i]).acceptOwnership();
        vm.stopBroadcast();
        for (uint256 i; i < list.length; i++) console.log("accepted", list[i]);
        console.log("Next: forge script script/VerifyDeploy.s.sol --rpc-url $env:RPC");
    }
}
