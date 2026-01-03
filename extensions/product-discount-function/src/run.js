// @ts-check
import { DiscountApplicationStrategy } from "../generated/api";

/**
 * @typedef {import("../generated/api").RunInput} RunInput
 * @typedef {import("../generated/api").FunctionRunResult} FunctionRunResult
 */

/**
 * @type {FunctionRunResult}
 */
const EMPTY_DISCOUNT = {
  discountApplicationStrategy: DiscountApplicationStrategy.First,
  discounts: [],
};

/**
 * @param {RunInput} input
 * @returns {FunctionRunResult}
 */
export function run(input) {
  // Get discount configuration from shop metafield
  const configValue = input?.shop?.metafield?.value;
  if (!configValue) {
    console.error("No discount configuration found");
    return EMPTY_DISCOUNT;
  }

  let discountConfigs;
  try {
    discountConfigs = JSON.parse(configValue);
  } catch (error) {
    console.error("Failed to parse discount configuration:", error);
    return EMPTY_DISCOUNT;
  }

  const discounts = [];

  // Check each cart line for eligible discounts
  for (const line of input.cart.lines) {
    if (line.merchandise.__typename === "ProductVariant") {
      const productId = line.merchandise.product.id;
      const quantity = line.quantity;

      // Find matching discount config for this product
      const config = discountConfigs.find(c => c.productId === productId);

      if (config && quantity >= config.minQuantity) {
        discounts.push({
          message: `${config.discountPercentage}% off`,
          targets: [
            {
              productVariant: {
                id: line.merchandise.id,
              },
            },
          ],
          value: {
            percentage: {
              value: config.discountPercentage.toString(),
            },
          },
        });
      }
    }
  }

  console.log(`Applied ${discounts.length} discounts`);

  return {
    discountApplicationStrategy: DiscountApplicationStrategy.First,
    discounts,
  };
};
