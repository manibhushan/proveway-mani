import { useLoaderData } from "react-router";
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

export default function Offers() {
  const { offers } = useLoaderData();

  return (
    <Page
      title="Offers"
      primaryAction={{
        content: "Create offer",
        url: "/app/discount-products",
      }}
    >
      <Layout>
        <Layout.Section>
          <Banner>
            <p>This page shows the active offers configured for your store.</p>
          </Banner>
        </Layout.Section>

        <Layout.Section>
          <Card>
            {offers.length === 0 ? (
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
                items={offers}
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
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "flex-start",
                        }}
                      >
                        <div>
                          <Text variant="bodyMd" fontWeight="bold" as="h3">
                            {title}
                          </Text>
                          <Text variant="bodySm" tone="subdued">
                            {priceRangeV2?.minVariantPrice?.amount} {" "}
                            {priceRangeV2?.minVariantPrice?.currencyCode}
                          </Text>
                          <Text variant="bodySm" tone="subdued">
                            Min Quantity: {minQuantity}
                          </Text>
                        </div>
                        <Text as="p" fontWeight="bold">
                          {discountPercentage}% off
                        </Text>
                      </div>
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
