use super::schema;
use shopify_function::prelude::*;
use shopify_function::Result;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DiscountConfig {
    product_id: String,
    discount_percentage: f64,
    min_quantity: i64,
}

#[shopify_function]
fn run(input: schema::run::Input) -> Result<schema::FunctionRunResult> {
    let no_discount = schema::FunctionRunResult {
        discounts: vec![],
        discount_application_strategy: schema::DiscountApplicationStrategy::First,
    };

    // Get discount configuration from shop metafield
    let config_value = match input.shop().metafield() {
        Some(metafield) => match metafield.value() {
            Some(value) => value,
            None => return Ok(no_discount),
        },
        None => return Ok(no_discount),
    };

    // Parse the JSON configuration
    let discount_configs: Vec<DiscountConfig> = match serde_json::from_str(config_value) {
        Ok(configs) => configs,
        Err(_) => return Ok(no_discount),
    };

    let mut discounts = vec![];

    // Check each cart line for eligible discounts
    for line in input.cart().lines() {
        if let schema::run::Merchandise::ProductVariant(variant) = line.merchandise() {
            let product_id = variant.product().id();
            let quantity = line.quantity();

            // Find matching discount config for this product
            if let Some(config) = discount_configs.iter().find(|c| c.product_id == product_id) {
                // Check if quantity meets minimum requirement
                if quantity >= config.min_quantity {
                    discounts.push(schema::Discount {
                        message: Some(format!("{}% off", config.discount_percentage)),
                        targets: vec![schema::Target::ProductVariant(schema::ProductVariantTarget {
                            id: variant.id().to_string(),
                            quantity: None,
                        })],
                        value: schema::Value::Percentage(schema::Percentage {
                            value: config.discount_percentage.to_string(),
                        }),
                    });
                }
            }
        }
    }

    Ok(schema::FunctionRunResult {
        discounts,
        discount_application_strategy: schema::DiscountApplicationStrategy::First,
    })
}
