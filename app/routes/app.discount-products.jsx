import { useState, useCallback, useEffect } from "react";
import { data } from "react-router";
import { useLoaderData, useSubmit, useActionData, useNavigation } from "react-router";
import {
  Page,
  Layout,
  Card,
  Button,
  ResourceList,
  ResourceItem,
  Thumbnail,
  Text,
  Banner,
  EmptyState,
  TextField,
  InlineStack,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";

// Loader - Fetch saved products
export async function loader({ request }) {
  const { admin } = await authenticate.admin(request);

  // Fetch saved product IDs from metafield
  const response = await admin.graphql(
    `#graphql
      query getDiscountProducts {
        shop {
          metafield(namespace: "volume_discount", key: "rules") {
            value
          }
        }
      }`
  );

  const responseData = await response.json();
  console.log('Loader - Raw response:', JSON.stringify(responseData, null, 2));

  const savedDiscounts = responseData.data.shop.metafield?.value
    ? JSON.parse(responseData.data.shop.metafield.value)
    : [];

  console.log('Loader - Saved discounts:', JSON.stringify(savedDiscounts, null, 2));

  // Fetch product details if we have saved discounts
  let products = [];
  if (savedDiscounts.length > 0) {
    const productIds = savedDiscounts.map(d => d.productId);
    const productQuery = `#graphql
      query getProducts($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on Product {
            id
            title
            featuredImage {
              url
              altText
            }
            priceRangeV2 {
              minVariantPrice {
                amount
                currencyCode
              }
            }
          }
        }
      }`;

    const productResponse = await admin.graphql(productQuery, {
      variables: { ids: productIds }
    });

    const productData = await productResponse.json();
    const productNodes = productData.data.nodes.filter(node => node !== null);

    // Merge product data with discount percentages and quantity requirement
    products = productNodes.map(product => {
      const discount = savedDiscounts.find(d => d.productId === product.id);
      return {
        ...product,
        discountPercentage: discount?.discountPercentage || 0,
        minQuantity: discount?.minQuantity || 2
      };
    });
  }  console.log('Loader - Final products:', JSON.stringify(products, null, 2));
  return data({ products, savedDiscounts });
}

// Action - Save selected products
export async function action({ request }) {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const actionType = formData.get("action");

  if (actionType === "save") {
    const discountData = JSON.parse(formData.get("discountData"));
    console.log('Action - Saving discount data:', JSON.stringify(discountData, null, 2));

    // First, get the shop's GID
    const shopQuery = await admin.graphql(
      `#graphql
        query {
          shop {
            id
          }
        }`
    );

    const shopData = await shopQuery.json();
    const shopGid = shopData.data.shop.id;
    console.log('Action - Shop GID:', shopGid);

    // Save to metafield
    const response = await admin.graphql(
      `#graphql
        mutation setDiscountProducts($metafields: [MetafieldsSetInput!]!) {
          metafieldsSet(metafields: $metafields) {
            metafields {
              id
              namespace
              key
              value
            }
            userErrors {
              field
              message
            }
          }
        }`,
      {
        variables: {
          metafields: [
            {
              namespace: "volume_discount",
              key: "rules",
              type: "json",
              value: JSON.stringify(discountData),
              ownerId: shopGid
            }
          ]
        }
      }
    );

    const result = await response.json();
    console.log('Action - Save result:', JSON.stringify(result, null, 2));

    if (result.data?.metafieldsSet?.userErrors?.length > 0) {
      console.error('Action - Save errors:', result.data.metafieldsSet.userErrors);
    }

    // Create or update the automatic discount
    try {
      // First, get the function ID from Shopify
      const functionsQuery = await admin.graphql(
        `#graphql
          query {
            shopifyFunctions(first: 25) {
              nodes {
                id
                apiType
                title
                apiVersion
              }
            }
          }`
      );

      const functionsData = await functionsQuery.json();
      console.log("Available functions:", JSON.stringify(functionsData, null, 2));

      const productDiscountFunction = functionsData.data?.shopifyFunctions?.nodes?.find(
        fn => fn.apiType === "product_discounts"
      );

      if (!productDiscountFunction) {
        console.error("Product discount function not found!");
        return data({ success: true, data: result, discountError: "Function not found" });
      }

      const functionId = productDiscountFunction.id;
      console.log("Using function ID:", functionId);

      // Check if discount already exists
      const existingDiscountsQuery = await admin.graphql(
        `#graphql
          query {
            automaticDiscountNodes(first: 10) {
              edges {
                node {
                  id
                  automaticDiscount {
                    ... on DiscountAutomaticApp {
                      title
                      discountClass
                    }
                  }
                }
              }
            }
          }`
      );

      const existingData = await existingDiscountsQuery.json();
      console.log("Existing discounts:", JSON.stringify(existingData, null, 2));

      let discountId = null;

      // Find our discount by title
      const edges = existingData.data?.automaticDiscountNodes?.edges || [];
      for (const edge of edges) {
        if (edge.node.automaticDiscount?.title === "Quantity Discount") {
          discountId = edge.node.id;
          break;
        }
      }

      if (discountId) {
        console.log("Updating existing discount:", discountId);

        const updateResponse = await admin.graphql(
          `#graphql
            mutation discountAutomaticAppUpdate($id: ID!, $automaticAppDiscount: DiscountAutomaticAppInput!) {
              discountAutomaticAppUpdate(id: $id, automaticAppDiscount: $automaticAppDiscount) {
                automaticAppDiscount {
                  discountId
                }
                userErrors {
                  field
                  message
                }
              }
            }`,
          {
            variables: {
              id: discountId,
              automaticAppDiscount: {
                title: "Quantity Discount",
                functionId: functionId,
                startsAt: new Date().toISOString(),
              },
            },
          }
        );

        const updateResult = await updateResponse.json();
        console.log("Discount update result:", JSON.stringify(updateResult, null, 2));

        if (updateResult.data?.discountAutomaticAppUpdate?.userErrors?.length > 0) {
          console.error("Update errors:", updateResult.data.discountAutomaticAppUpdate.userErrors);
        }
      } else {
        console.log("Creating new discount with function ID:", functionId);

        const createResponse = await admin.graphql(
          `#graphql
            mutation discountAutomaticAppCreate($automaticAppDiscount: DiscountAutomaticAppInput!) {
              discountAutomaticAppCreate(automaticAppDiscount: $automaticAppDiscount) {
                automaticAppDiscount {
                  discountId
                  title
                }
                userErrors {
                  field
                  message
                }
              }
            }`,
          {
            variables: {
              automaticAppDiscount: {
                title: "Quantity Discount",
                functionId: functionId,
                startsAt: new Date().toISOString(),
              },
            },
          }
        );

        const createResult = await createResponse.json();
        console.log("Discount creation result:", JSON.stringify(createResult, null, 2));

        if (createResult.data?.discountAutomaticAppCreate?.userErrors?.length > 0) {
          console.error("Creation errors:", createResult.data.discountAutomaticAppCreate.userErrors);
        }
      }
    } catch (error) {
      console.error('Failed to create/update discount:', error);
    }

    return data({ success: true, data: result });
  }

  return data({ success: false });
}

// Component
export default function DiscountProducts() {
  const { products } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const submit = useSubmit();
  const [selectedProducts, setSelectedProducts] = useState(products);
  const [showSuccessBanner, setShowSuccessBanner] = useState(false);

  const isLoading = navigation.state === "submitting";

  useEffect(() => {
    if (actionData?.success) {
      setShowSuccessBanner(true);
      const timer = setTimeout(() => setShowSuccessBanner(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [actionData]);

  const handleProductSelection = useCallback(async () => {
    const selected = await shopify.resourcePicker({
      type: "product",
      multiple: true,
    });

    if (selected) {
      const newProducts = [...selectedProducts];
      selected.forEach(product => {
        if (!newProducts.find(p => p.id === product.id)) {
          newProducts.push({
            ...product,
            discountPercentage: 10, // Default discount
            minQuantity: 2 // Hardcoded minimum quantity requirement
          });
        }
      });
      setSelectedProducts(newProducts);
    }
  }, [selectedProducts]);

  const handleRemoveProduct = useCallback((productId) => {
    setSelectedProducts(selectedProducts.filter(p => p.id !== productId));
  }, [selectedProducts]);

  const handleDiscountChange = useCallback((productId, value) => {
    setSelectedProducts(selectedProducts.map(p =>
      p.id === productId ? { ...p, discountPercentage: parseFloat(value) || 0 } : p
    ));
  }, [selectedProducts]);

  const handleSave = useCallback(() => {
    const discountData = selectedProducts.map(p => ({
      productId: p.id,
      discountPercentage: p.discountPercentage,
      minQuantity: p.minQuantity || 2
    }));
    const formData = new FormData();
    formData.append("action", "save");
    formData.append("discountData", JSON.stringify(discountData));

    submit(formData, { method: "post" });
  }, [selectedProducts, submit]);

  return (
    <Page
      title="Discount Products"
      primaryAction={{
        content: "Select Products",
        onAction: handleProductSelection,
      }}
      secondaryActions={[
        {
          content: "Save",
          onAction: handleSave,
          disabled: selectedProducts.length === 0,
          loading: isLoading,
        },
      ]}
    >
      <Layout>
        {showSuccessBanner && (
          <Layout.Section>
            <Banner tone="success" onDismiss={() => setShowSuccessBanner(false)}>
              <p>Discount settings saved successfully!</p>
            </Banner>
          </Layout.Section>
        )}
        <Layout.Section>
          <Banner>
            <p>Select products that will receive automatic discounts when added to cart. Discount applies only when quantity is 2 or more.</p>
          </Banner>
        </Layout.Section>

        <Layout.Section>
          <Card>
            {selectedProducts.length === 0 ? (
              <EmptyState
                heading="No products selected"
                action={{
                  content: "Select Products",
                  onAction: handleProductSelection,
                }}
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <p>Choose products that should receive cart discounts.</p>
              </EmptyState>
            ) : (
              <ResourceList
                resourceName={{ singular: "product", plural: "products" }}
                items={selectedProducts}
                renderItem={(item) => {
                  const { id, title, featuredImage, priceRangeV2, discountPercentage, minQuantity } = item;
                  const media = (
                    <Thumbnail
                      source={featuredImage?.url || ""}
                      alt={featuredImage?.altText || title}
                    />
                  );

                  return (
                    <ResourceItem
                      id={id}
                      media={media}
                      accessibilityLabel={`View details for ${title}`}
                    >
                      <InlineStack align="space-between" blockAlign="center">
                        <div style={{ flex: 1 }}>
                          <Text variant="bodyMd" fontWeight="bold" as="h3">
                            {title}
                          </Text>
                          <div style={{ marginTop: "4px" }}>
                            <Text variant="bodySm" as="p" tone="subdued">
                              {priceRangeV2?.minVariantPrice?.amount}{" "}
                              {priceRangeV2?.minVariantPrice?.currencyCode}
                            </Text>
                          </div>
                          <div style={{ marginTop: "4px" }}>
                            <Text variant="bodySm" as="p" tone="info">
                              Min. Quantity: {minQuantity || 2}
                            </Text>
                          </div>
                        </div>
                        <div style={{ width: "120px", marginRight: "16px" }}>
                          <TextField
                            label=""
                            type="number"
                            value={String(discountPercentage || 0)}
                            onChange={(value) => handleDiscountChange(id, value)}
                            suffix="%"
                            min={0}
                            max={100}
                            autoComplete="off"
                          />
                        </div>
                        <Button
                          plain
                          destructive
                          onClick={() => handleRemoveProduct(id)}
                        >
                          Remove
                        </Button>
                      </InlineStack>
                    </ResourceItem>
                  );
                }}
              />
            )}
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
