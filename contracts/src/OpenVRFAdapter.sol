// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @notice Adapter between Fire.sol and Robinhood's OpenVRF (drand-backed) router.
 *         https://github.com/Robinhood-OSS/OpenVRF
 *
 *         Fire.roll() -> request() -> router.requestRandomness{value: fee}(callbackGas)
 *         router -> rawFulfillRandomness(id, word) -> Fire.onRandomness(id, word)
 *
 *         TODO before deploy: pin the exact OpenVRF RandomnessConsumer base + router address from the
 *         repo's deployments folder (not in the README as of Sep 26 2026), and confirm the fee model.
 */
interface IOpenVRFRouter {
    function requestRandomness(uint32 callbackGas) external payable returns (uint256);
}

interface IFireRandomnessSink {
    function onRandomness(uint256 requestId, uint256 rnd) external;
}

contract OpenVRFAdapter {
    IOpenVRFRouter public immutable ROUTER;
    address public immutable FIRE;
    uint32 public constant CALLBACK_GAS = 600_000;

    error OnlyFire();
    error OnlyRouter();

    constructor(address router, address fire) {
        ROUTER = IOpenVRFRouter(router);
        FIRE = fire;
    }

    /// @dev Fire calls this. The adapter holds a little ETH to pay request fees (if the router charges).
    function request() external returns (uint256 id) {
        if (msg.sender != FIRE) revert OnlyFire();
        id = ROUTER.requestRandomness{value: address(this).balance}(CALLBACK_GAS);
    }

    /// @dev Router callback. Name/signature per OpenVRF's RandomnessConsumer.
    function rawFulfillRandomness(uint256 requestId, uint256 randomWord) external {
        if (msg.sender != address(ROUTER)) revert OnlyRouter();
        IFireRandomnessSink(FIRE).onRandomness(requestId, randomWord);
    }

    receive() external payable {}
}
