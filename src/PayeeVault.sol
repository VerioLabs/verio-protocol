// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title PayeeVault
/// @notice A dedicated payee address for one ResourceRegistry resource. Agents pay it (x402 settles USDC with
///         `transferWithAuthorization`), and anyone can push its balance on to the fixed `beneficiary`. It has no
///         owner, admin or upgrade path: the only way funds leave is to the beneficiary, or wherever the
///         beneficiary itself sends them with `sweepTo`.
/// @dev Deployed by PayeeVaultFactory with CREATE2, so the address is known (and can receive payments) before
///      any code is there. The beneficiary is part of the init code, so the address commits to it.
contract PayeeVault {
    /// @notice Thrown when someone other than the beneficiary calls `sweepTo`.
    error NotBeneficiary();
    /// @notice Thrown when an address argument that must be set is zero.
    error ZeroAddress();
    /// @notice Thrown when a token or ETH transfer fails.
    error TransferFailed();

    /// @notice `amount` of `token` (zero address: ETH) left the vault for `to`.
    event Swept(address indexed token, address indexed to, uint256 amount);

    /// @notice The address every sweep pays out to.
    address public immutable beneficiary;

    constructor(address beneficiary_) {
        if (beneficiary_ == address(0)) revert ZeroAddress();
        beneficiary = beneficiary_;
    }

    receive() external payable {}

    /// @notice Send the vault's whole balance of `token` (zero address: ETH) to the beneficiary. Anyone may call;
    ///         the destination is fixed, so the caller only pays the gas.
    /// @return amount What was sent; zero when the balance was zero.
    function sweep(address token) external returns (uint256 amount) {
        return _send(token, beneficiary);
    }

    /// @notice Send the vault's whole balance of `token` to `to`. Beneficiary only: the way out when the
    ///         beneficiary cannot receive a token itself (for example, it was blocklisted by the token's issuer).
    function sweepTo(address token, address to) external returns (uint256 amount) {
        if (msg.sender != beneficiary) revert NotBeneficiary();
        if (to == address(0)) revert ZeroAddress();
        return _send(token, to);
    }

    function _send(address token, address to) private returns (uint256 amount) {
        if (token == address(0)) {
            amount = address(this).balance;
            if (amount == 0) return 0;
            (bool ok,) = to.call{value: amount}("");
            if (!ok) revert TransferFailed();
        } else {
            amount = IERC20Balance(token).balanceOf(address(this));
            if (amount == 0) return 0;
            // Tolerates tokens that return nothing from `transfer` as well as those that return a bool.
            (bool ok, bytes memory ret) = token.call(abi.encodeCall(IERC20Balance.transfer, (to, amount)));
            if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert TransferFailed();
        }
        emit Swept(token, to, amount);
    }
}

interface IERC20Balance {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
}
