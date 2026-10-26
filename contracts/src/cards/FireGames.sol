// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable2Step, Ownable} from "openzeppelin-contracts/contracts/access/Ownable2Step.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";
import {EIP712} from "openzeppelin-contracts/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "openzeppelin-contracts/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title FireGames
 * @notice The game room's entries (docs/paper-football.md, "On chain"). Each game has an id and an entry in PAPER,
 *         fixed forever once the owner adds it (paper football is game 1, 1 PAPER a run). A player pays for one run
 *         of one game: the entry is burned straight to the dead address, and the run id is recorded as theirs, once.
 *
 *         Every run needs the game server's EIP-712 approval (`signer`) over the game, the run id, the player, the
 *         Series and a deadline. The server gives it only after its own checks (where the player is, 18+), and starts
 *         the run once it sees `RunPaid` for that id from that wallet. Prizes are FireCredits.awardPrizes (capped
 *         there per game per Series).
 *
 *         Kill switches: `paused` stops every game at once, `setGameOpen` one game. `series` is the competition new
 *         runs go into (moved on at each Series launch; 0 = closed), and a run names the one it pays for, so a run paid
 *         as the switch happens can't land in the wrong one.
 *
 *         Holds nothing, and the only token it ever moves is the entry, from the caller, to the dead address.
 */
contract FireGames is Ownable2Step, EIP712 {
    using SafeERC20 for IERC20;

    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;
    bytes32 public constant RUN_TYPEHASH =
        keccak256("Run(uint256 gameId,bytes32 runId,address player,uint256 series,uint256 deadline)");

    IERC20 public immutable PAPER;
    /// @notice The game server's key that approves each run (0 = no runs).
    address public signer;
    /// @notice The Series whose competition takes new runs (0 = none).
    uint256 public series;
    /// @notice The kill switch for every game: no new runs while true.
    bool public paused;
    /// @notice Each game's entry in PAPER wei (0 = no such game). Set once, when the game is added; never changes.
    mapping(uint256 gameId => uint256) public entryOf;
    /// @notice Whether a game takes new runs (its own kill switch).
    mapping(uint256 gameId => bool) public gameOpen;
    /// @notice Who paid each run (a run id is paid once, across all games).
    mapping(bytes32 runId => address) public runBy;

    event RunPaid(uint256 indexed gameId, bytes32 indexed runId, address indexed player, uint256 series, uint256 paper);
    event GameAdded(uint256 indexed gameId, uint256 entry);
    event GameOpenSet(uint256 indexed gameId, bool open);
    event SignerSet(address signer);
    event SeriesSet(uint256 series);
    event Paused(bool paused);

    error IsPaused();
    error NotOpen();
    error NoGame();
    error AlreadyAdded();
    error AlreadyPaid();
    error Expired();
    error BadSignature();
    error BadConfig();
    error RenounceDisabled();

    constructor(address owner_, address paper) Ownable(owner_) EIP712("FireGames", "1") {
        if (paper == address(0)) revert BadConfig();
        PAPER = IERC20(paper);
    }

    /// @notice Pay for run `runId` of game `gameId` in Series `forSeries`' competition: burns the game's entry (approve
    ///         this contract for it). `sig` is the game server's approval of exactly this run for the caller.
    function payRun(uint256 gameId, bytes32 runId, uint256 forSeries, uint256 deadline, bytes calldata sig) external {
        address s = signer;
        if (s == address(0)) revert NotOpen();
        (address got, ECDSA.RecoverError e,) = ECDSA.tryRecover(runDigest(gameId, runId, msg.sender, forSeries, deadline), sig);
        if (e != ECDSA.RecoverError.NoError || got != s) revert BadSignature();
        if (paused) revert IsPaused();
        uint256 entry = entryOf[gameId];
        if (entry == 0) revert NoGame();
        if (!gameOpen[gameId] || series == 0 || forSeries != series) revert NotOpen();
        if (block.timestamp > deadline) revert Expired();
        if (runId == bytes32(0) || runBy[runId] != address(0)) revert AlreadyPaid();
        runBy[runId] = msg.sender;
        PAPER.safeTransferFrom(msg.sender, DEAD, entry);
        emit RunPaid(gameId, runId, msg.sender, forSeries, entry);
    }

    /// @notice The EIP-712 digest the server signs for a run.
    function runDigest(uint256 gameId, bytes32 runId, address player, uint256 forSeries, uint256 deadline)
        public
        view
        returns (bytes32)
    {
        return _hashTypedDataV4(keccak256(abi.encode(RUN_TYPEHASH, gameId, runId, player, forSeries, deadline)));
    }

    // ================================================================ owner

    /// @notice Add a game with its entry (PAPER wei). Opens it. The entry can never change, and a game can't be added
    ///         twice.
    function addGame(uint256 gameId, uint256 entry) external onlyOwner {
        if (gameId == 0 || entry == 0) revert BadConfig();
        if (entryOf[gameId] != 0) revert AlreadyAdded();
        entryOf[gameId] = entry;
        gameOpen[gameId] = true;
        emit GameAdded(gameId, entry);
        emit GameOpenSet(gameId, true);
    }

    /// @notice One game's kill switch.
    function setGameOpen(uint256 gameId, bool open) external onlyOwner {
        if (entryOf[gameId] == 0) revert NoGame();
        gameOpen[gameId] = open;
        emit GameOpenSet(gameId, open);
    }

    /// @notice The kill switch for every game.
    function setPaused(bool p) external onlyOwner {
        paused = p;
        emit Paused(p);
    }

    /// @notice The competition new runs go into (at a new Series' launch); 0 closes it to new runs.
    function setSeries(uint256 s) external onlyOwner {
        series = s;
        emit SeriesSet(s);
    }

    /// @notice The game server's approval key (0 = no runs).
    function setSigner(address s) external onlyOwner {
        signer = s;
        emit SignerSet(s);
    }

    /// @notice Ownership can be handed over (two steps) but never renounced.
    function renounceOwnership() public pure override {
        revert RenounceDisabled();
    }
}
