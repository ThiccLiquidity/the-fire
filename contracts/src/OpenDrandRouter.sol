// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

// Derived from Robinhood-OSS/OpenVRF src/OpenVRF.sol @ 9fb960c (Apache-2.0; see test/vendor/OpenVRF-LICENSE).
// Changes: no owner, no fees, no consumer or relayer allowlists — fulfill() and retryCallback() are open to anyone.
// Round selection, drand verification (bls-solidity EvmnetRegistry, pinned evmnet key) and word derivation are
// unchanged.

import {EvmnetRegistry} from "bls-solidity/demos/EvmnetRegistry.sol";

interface IRandomnessConsumer {
    function rawFulfillRandomness(uint256 requestId, uint256 randomWord) external;
}

/**
 * @title OpenDrandRouter
 * @notice drand-verified randomness with nobody in charge. A request commits to a drand evmnet round 30-33 seconds in
 *         the future. Once drand publishes that round, anyone may submit its BLS signature: the router verifies it
 *         on-chain and derives the request's word. There is exactly one valid word per request, so whoever submits
 *         it — our keeper, the site's button, or a stranger — delivers the same result, and nobody can hold a result
 *         back to get a different one: if one party sits on it, anyone else can deliver it.
 *
 *         Why not OpenVRF as deployed: its fulfill() is relayer-only. The one relayer could then withhold a word it
 *         doesn't like until the consumer re-requests, choosing among draws.
 */
contract OpenDrandRouter is EvmnetRegistry {
    uint256 public constant GENESIS = 1727521075;
    uint256 public constant PERIOD = 3;
    /// @dev Rounds are 3 s apart. 30 s ahead (10 rounds) keeps the chosen round in the future even if the sequencer
    ///      clock lags real time by a few seconds; otherwise whoever requests could get a round that is already public.
    uint256 public constant MIN_DELAY = 30;
    uint32 public constant MAX_CALLBACK_GAS = 1_000_000;
    bytes32 public constant CHAIN_HASH = 0x04f1e9062b8a81f848fded9c12306733282b2727ecced50032187751166ec8c3;

    /// @dev Same layout as OpenVRF's, so its tooling (and our adapter) read it unchanged. fee is always 0.
    struct Request {
        address consumer;
        uint64 round;
        uint32 callbackGasLimit;
        bool fulfilled;
        bool delivered;
        uint256 randomWord;
        uint256 fee;
    }

    uint256 public nextRequestId = 1;
    mapping(uint256 => Request) public requests;
    bool private delivering;

    event RandomnessRequested(uint256 indexed requestId, address indexed consumer, uint64 round);
    event RandomnessFulfilled(uint256 indexed requestId, uint256 randomWord);
    event CallbackAttempted(uint256 indexed requestId, bool success);

    error InvalidRequest();
    error NotReady();
    error AlreadyFulfilled();
    error InvalidCallback();
    error InsufficientGas();
    error ReentrantDelivery();
    error IncorrectFee();

    modifier deliveryLock() {
        if (delivering) revert ReentrantDelivery();
        delivering = true;
        _;
        delivering = false;
    }

    /// @notice Always 0. Kept so OpenVRF-style consumers work unchanged.
    function requestFee() external pure returns (uint256) {
        return 0;
    }

    function requestRandomness(uint32 callbackGasLimit) external payable returns (uint256 id) {
        if (msg.value != 0) revert IncorrectFee();
        if (msg.sender.code.length == 0 || callbackGasLimit < 25_000 || callbackGasLimit > MAX_CALLBACK_GAS) {
            revert InvalidRequest();
        }
        // The earliest evmnet round at least MIN_DELAY seconds ahead (30-33 seconds).
        uint256 roundValue = (block.timestamp + MIN_DELAY - GENESIS + PERIOD - 1) / PERIOD + 1;
        if (roundValue > type(uint64).max) revert InvalidRequest();
        // forge-lint: disable-next-line(unsafe-typecast)
        uint64 round = uint64(roundValue);
        id = nextRequestId++;
        requests[id] = Request({
            consumer: msg.sender,
            round: round,
            callbackGasLimit: callbackGasLimit,
            fulfilled: false,
            delivered: false,
            randomWord: 0,
            fee: 0
        });
        emit RandomnessRequested(id, msg.sender, round);
    }

    /// @notice Anyone: submit the drand signature for the request's round.
    function fulfill(uint256 id, bytes calldata signature) external deliveryLock {
        Request storage request = requests[id];
        if (request.consumer == address(0)) revert InvalidRequest();
        if (request.fulfilled) revert AlreadyFulfilled();
        if (block.timestamp < GENESIS + (uint256(request.round) - 1) * PERIOD) revert NotReady();
        this.proveRound(signature, request.round);
        request.randomWord = uint256(
            keccak256(
                abi.encode(CHAIN_HASH, roundRandomness[request.round], block.chainid, address(this), id, request.consumer)
            )
        );
        request.fulfilled = true;
        emit RandomnessFulfilled(id, request.randomWord);
        _deliver(id, request);
    }

    /// @notice Anyone: retry delivering the same word after a consumer revert or too little gas.
    function retryCallback(uint256 id, uint32 callbackGasLimit) external deliveryLock {
        Request storage request = requests[id];
        if (
            !request.fulfilled || request.delivered || callbackGasLimit < request.callbackGasLimit
                || callbackGasLimit > MAX_CALLBACK_GAS
        ) revert InvalidCallback();
        request.callbackGasLimit = callbackGasLimit;
        _deliver(id, request);
    }

    function _deliver(uint256 id, Request storage request) private {
        bytes memory payload = abi.encodeCall(IRandomnessConsumer.rawFulfillRandomness, (id, request.randomWord));
        uint256 callGas = request.callbackGasLimit;
        address consumer = request.consumer;
        // The caller must supply the full callback gas (plus EIP-150's 1/64 and bookkeeping), so a stranger can't
        // make delivery fail on purpose by sending too little.
        if (gasleft() < callGas + callGas / 63 + 60_000) revert InsufficientGas();
        bool success;
        if (consumer.code.length != 0) {
            request.delivered = true;
            assembly {
                success := call(callGas, consumer, 0, add(payload, 32), mload(payload), 0, 0)
            }
        }
        request.delivered = success;
        emit CallbackAttempted(id, success);
    }
}
