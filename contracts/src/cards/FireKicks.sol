// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable2Step, Ownable} from "openzeppelin-contracts/contracts/access/Ownable2Step.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title FireKicks
 * @notice Entry to a paper football competition run (docs/paper-football.md): one piece of PAPER buys one piece of
 *         paper to fold and play one run. The player burns exactly ENTRY (1 PAPER, fixed forever) for a run named by
 *         the game server's run id. The server starts the run only once it sees
 *         `RunPaid` for that id from that wallet, checks every kick, and keeps the Series' leaderboard; the top three
 *         get free pack credits through FireCredits.awardPrizes (6 per Series at most, capped there).
 *
 *         The owner's kill switch (`setPaused`) stops new runs at once. `series` is the competition runs go into: a
 *         new Series moves it on (closing the old competition to new runs), and a run names the one it pays for, so a
 *         run paid as the switch happens can't land in the wrong one. Holds nothing: the PAPER goes straight to the
 *         burn address.
 */
contract FireKicks is Ownable2Step {
    using SafeERC20 for IERC20;

    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;
    /// @notice What a run burns: 1 PAPER, always. No setting can change it.
    uint256 public constant ENTRY = 1e18;

    IERC20 public immutable PAPER;
    /// @notice The Series whose competition takes new runs (0 = none).
    uint256 public series;
    /// @notice The kill switch: no new runs while true.
    bool public paused;
    /// @notice Who paid each run (a run id is paid once).
    mapping(bytes32 runId => address) public runBy;

    event RunPaid(bytes32 indexed runId, address indexed player, uint256 indexed series, uint256 paper);
    event SeriesSet(uint256 series);
    event Paused(bool paused);

    error IsPaused();
    error NotOpen();
    error AlreadyPaid();
    error BadConfig();
    error RenounceDisabled();

    constructor(address owner_, address paper) Ownable(owner_) {
        if (paper == address(0)) revert BadConfig();
        PAPER = IERC20(paper);
    }

    /// @notice Pay for run `runId` in Series `forSeries`' competition: burns 1 PAPER (approve this contract for it).
    function payRun(bytes32 runId, uint256 forSeries) external {
        if (paused) revert IsPaused();
        if (series == 0 || forSeries != series) revert NotOpen();
        if (runId == bytes32(0) || runBy[runId] != address(0)) revert AlreadyPaid();
        runBy[runId] = msg.sender;
        PAPER.safeTransferFrom(msg.sender, DEAD, ENTRY);
        emit RunPaid(runId, msg.sender, forSeries, ENTRY);
    }

    // ================================================================ owner

    /// @notice The kill switch.
    function setPaused(bool p) external onlyOwner {
        paused = p;
        emit Paused(p);
    }

    /// @notice The competition new runs go into (at a new Series' launch); 0 closes it to new runs.
    function setSeries(uint256 s) external onlyOwner {
        series = s;
        emit SeriesSet(s);
    }

    /// @notice Ownership can be handed over (two steps) but never renounced.
    function renounceOwnership() public pure override {
        revert RenounceDisabled();
    }
}
