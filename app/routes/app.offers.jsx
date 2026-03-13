import { useState, useEffect } from "react";
import {
  useLoaderData,
  useActionData,
  useSubmit,
  useNavigation,
} from "react-router";
import {
  Page,
  Layout,
  Card,
  ResourceList,
  ResourceItem,
  Thumbnail,
  Text,
  Banner,
  EmptyState,
  TextField,
  Button,
  InlineStack,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";

export async function loader({ request }) {
  const { admin } = await authenticate.admin(request);

  const response = await admin.graphql(
    `#graphql
      query getOffers {
        shop {
          metafield(namespace: "volume_discount", key: "rules") {
            value
          }
        }
      }`
  );

  const responseData = await response.json();
  const savedOffers = responseData.data.shop.metafield?.value
    ? JSON.parse(responseData.data.shop.metafield.value)
    : [];

  let offers = [];

  if (savedOffers.length > 0) {
    const productIds = savedOffers.map((o) => o.productId);

    const productResponse = await admin.graphql(
      `#graphql
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
        }`,
      { variables: { ids: productIds } }
    );

    const productData = await productResponse.json();
    const productNodes = productData.data.nodes.filter(Boolean);

    offers = productNodes.map((product) => {
      const offer = savedOffers.find((o) => o.productId === product.id);
      return {
        ...product,
        discountPercentage: offer?.discountPercentage ?? 0,
        minQuantity: offer?.minQuantity ?? 2,
      };
    });
  }

  return { offers };
}

export async function action({ request }) {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const offerData = JSON.parse(formData.get("offers") || "[]");

  // Get shop GID
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

  // Update metafield
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
            value: JSON.stringify(offerData),
            ownerId: shopGid,
          },
        ],
      },
    }
  );

  const result = await response.json();
  const hasErrors =
    result.data?.metafieldsSet?.userErrors?.length > 0 ||
    result.errors?.length > 0;

  return { success: !hasErrors, errors: result.data?.metafieldsSet?.userErrors };
}

export default function Offers() {
  const { offers } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const submit = useSubmit();

  const [localOffers, setLocalOffers] = useState(offers);
  const [showSuccessBanner, setShowSuccessBanner] = useState(false);

  useEffect(() => {
    setLocalOffers(offers);
  }, [offers]);

  useEffect(() => {
    if (actionData?.success) {
      setShowSuccessBanner(true);
      const timer = setTimeout(() => setShowSuccessBanner(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [actionData]);

  const isSaving = navigation.state === "submitting";

  const updateOffer = (id, fields) => {
    setLocalOffers((current) =>
      current.map((offer) =>
        offer.id === id ? { ...offer, ...fields } : offer
      )
    );
  };

  const removeOffer = (id) => {
    setLocalOffers((current) => current.filter((offer) => offer.id !== id));
  };

  const saveOffers = () => {
    const payload = localOffers.map((offer) => ({
      productId: offer.id,
      discountPercentage: Number(offer.discountPercentage) || 0,
      minQuantity: Number(offer.minQuantity) || 2,
    }));

    const formData = new FormData();
    formData.append("offers", JSON.stringify(payload));
    submit(formData, { method: "post" });
  };

  return (
    <Page
      title="Offers"
      primaryAction={{
        content: "Create offer",
        url: "/app/discount-products",
      }}
      secondaryActions={[
        {
          content: "Save",
          onAction: saveOffers,
          disabled: localOffers.length === 0,
          loading: isSaving,
        },
      ]}
    >
      <Layout>
        <Layout.Section>
          <Banner>
            <p>This page shows the active offers configured for your store.</p>
          </Banner>
        </Layout.Section>

        {showSuccessBanner && (
          <Layout.Section>
            <Banner tone="success" onDismiss={() => setShowSuccessBanner(false)}>
              <p>Offers saved successfully.</p>
            </Banner>
          </Layout.Section>
        )}

        <Layout.Section>
          <Card>
            {localOffers.length === 0 ? (
              <EmptyState
                heading="No offers found"
                action={{
                  content: "Create an offer",
                  url: "/app/discount-products",
                }}
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <p>
                  Add products to the discount list to show them here as offers.
                </p>
              </EmptyState>
            ) : (
              <ResourceList
                resourceName={{ singular: "offer", plural: "offers" }}
                items={localOffers}
                renderItem={(item) => {
                  const {
                    id,
                    title,
                    featuredImage,
                    priceRangeV2,
                    discountPercentage,
                    minQuantity,
                  } = item;

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
                      <InlineStack
                        align="space-between"
                        blockAlign="center"
                        wrap={false}
                      >
                        <div style={{ flex: 1 }}>
                          <Text variant="bodyMd" fontWeight="bold" as="h3">
                            {title}
                          </Text>
                          <Text variant="bodySm" tone="subdued">
                            {priceRangeV2?.minVariantPrice?.amount} {" "}
                            {priceRangeV2?.minVariantPrice?.currencyCode}
                          </Text>
                        </div>

                        <TextField
                          label="Discount %"
                          type="number"
                          value={String(discountPercentage || 0)}
                          onChange={(value) =>
                            updateOffer(id, { discountPercentage: value })
                          }
                          suffix="%"
                          min={0}
                          max={100}
                          autoComplete="off"
                          style={{ width: 140 }}
                        />

                        <TextField
                          label="Min Quantity"
                          type="number"
                          value={String(minQuantity || 2)}
                          onChange={(value) =>
                            updateOffer(id, { minQuantity: value })
                          }
                          min={1}
                          autoComplete="off"
                          style={{ width: 140 }}
                        />

                        <Button
                          plain
                          destructive
                          onClick={() => removeOffer(id)}
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
