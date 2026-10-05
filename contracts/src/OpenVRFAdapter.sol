// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @notice Adapter between one consumer (FireCards or FirePsa; `FIRE` is the historical name) and a drand router with OpenVRF's interface — in production our OpenDrandRouter
 *         (OpenVRF with open fulfillment; see its header). https://github.com/Robinhood-OSS/OpenVRF @ 9fb960c
 *
 *         consumer -> request() -> router.requestRandomness{value: requestFee}(CALLBACK_GAS)
 *         router.fulfill() -> rawFulfillRandomness(id, word) -> consumer.onRandomness(id, word)
 *
 *         If the router has a result but its callback didn't reach the consumer (out of gas, a revert that has
 *         since cleared), anyone can call settle(id) to deliver the stored result. The router never changes
 *         a result once fulfilled, so settle() can't be used to pick a different number.
 */
interface IOpenVRFRouter {
    function requestRandomness(uint32 callbackGas) external payable returns (uint256);
    function requestFee() external view returns (uint256);
    function requests(uint256 id)
        external
        view
        returns (address consumer, uint64 round, uint32 callbackGasLimit, bool fulfilled, bool delivered, uint256 randomWord, uint256 fee);
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
    error NotFulfilled();
    error FeeUnpaid();

    constructor(address router, address fire) {
        ROUTER = IOpenVRFRouter(router);
        FIRE = fire;
    }

    /// @dev The consumer calls this. The router requires the exact fee (0 on our deployment); a paid fee comes from
    ///      ETH sent to this adapter ahead of time. Stray ETH here can no longer break requests.
    function request() external returns (uint256 id) {
        if (msg.sender != FIRE) revert OnlyFire();
        uint256 fee = ROUTER.requestFee();
        if (address(this).balance < fee) revert FeeUnpaid();
        id = ROUTER.requestRandomness{value: fee}(CALLBACK_GAS);
    }

    /// @notice True once the router holds the final random word for this request.
    function answered(uint256 id) external view returns (bool fulfilled) {
        (,,, fulfilled,,,) = ROUTER.requests(id);
    }

    /// @dev Router callback (OpenVRF's IRandomnessConsumer).
    function rawFulfillRandomness(uint256 requestId, uint256 randomWord) external {
        if (msg.sender != address(ROUTER)) revert OnlyRouter();
        IFireRandomnessSink(FIRE).onRandomness(requestId, randomWord);
    }

    /// @notice Anyone: deliver a result the router already holds but whose callback didn't land.
    function settle(uint256 id) external {
        (address consumer,,, bool fulfilled,, uint256 word,) = ROUTER.requests(id);
        if (!fulfilled || consumer != address(this)) revert NotFulfilled();
        IFireRandomnessSink(FIRE).onRandomness(id, word);
    }

    receive() external payable {}
}
