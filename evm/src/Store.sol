// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title Store
 * @notice Product registry for the browse.dot app store
 * @dev Products are indexed by auto-incrementing uint32 IDs.
 */
contract Store is Ownable {
    /*//////////////////////////////////////////////////////////////
                                 TYPES
    //////////////////////////////////////////////////////////////*/

    struct Product {
        string label; // DotNS label (e.g. "ohnotes") — namehash derivable as namehash("label.dot")
        string name;
        string description;
    }

    /*//////////////////////////////////////////////////////////////
                                 ERRORS
    //////////////////////////////////////////////////////////////*/

    error Store__EmptyLabel();
    error Store__ProductNotFound();

    /*//////////////////////////////////////////////////////////////
                                STORAGE
    //////////////////////////////////////////////////////////////*/

    uint32 public productCount;
    mapping(uint32 => Product) private s_products;

    /*//////////////////////////////////////////////////////////////
                                 EVENTS
    //////////////////////////////////////////////////////////////*/

    event ProductAdded(uint32 indexed productId, string label);
    event ProductRemoved(uint32 indexed productId, string label);
    event ProductUpdated(uint32 indexed productId);

    /*//////////////////////////////////////////////////////////////
                          EXTERNAL FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    constructor() Ownable(msg.sender) {}

    /**
     * @notice Register a new product in the store
     * @dev Reverts if the label is empty.
     * @param label The DotNS label (e.g. "ohnotes")
     * @param name Display name of the product
     * @param description Short description of the product
     * @return productId_ The ID assigned to the new product
     */
    function addProduct(
        string calldata label,
        string calldata name,
        string calldata description
    ) external onlyOwner returns (uint32 productId_) {
        if (bytes(label).length == 0) revert Store__EmptyLabel();

        productId_ = productCount++;
        s_products[productId_] = Product(label, name, description);

        emit ProductAdded(productId_, label);
    }

    /**
     * @notice Remove a product from the store
     * @param productId The ID of the product to remove
     */
    function removeProduct(uint32 productId) external onlyOwner {
        if (bytes(s_products[productId].label).length == 0)
            revert Store__ProductNotFound();

        string memory label = s_products[productId].label;
        delete s_products[productId];

        emit ProductRemoved(productId, label);
    }

    /**
     * @notice Update a product's name and description
     * @dev Label is immutable — remove and re-add to change it.
     * @param productId The ID of the product to update
     * @param name New display name
     * @param description New description
     */
    function updateProduct(
        uint32 productId,
        string calldata name,
        string calldata description
    ) external onlyOwner {
        if (bytes(s_products[productId].label).length == 0)
            revert Store__ProductNotFound();
        s_products[productId].name = name;
        s_products[productId].description = description;
        emit ProductUpdated(productId);
    }

    /*//////////////////////////////////////////////////////////////
                       EXTERNAL VIEW FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Get a product by its ID
     * @param productId The product ID to look up
     * @return product_ The product struct (zeroed if not found)
     */
    function getProduct(
        uint32 productId
    ) external view returns (Product memory product_) {
        return s_products[productId];
    }

    /**
     * @notice Get all active products
     * @dev Iterates 0..productCount and skips deleted entries.
     * @return products_ Array of all live products
     */
    function getProducts() external view returns (Product[] memory products_) {
        uint32 count = productCount;
        uint32 active = 0;
        for (uint32 i = 0; i < count; i++) {
            if (bytes(s_products[i].label).length != 0) active++;
        }

        products_ = new Product[](active);
        uint32 idx = 0;
        for (uint32 i = 0; i < count; i++) {
            if (bytes(s_products[i].label).length != 0) {
                products_[idx++] = s_products[i];
            }
        }
    }
}
