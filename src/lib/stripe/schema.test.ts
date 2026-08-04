import { describe, expect, it } from "vitest";
import { checkoutMetadataSchema, marketplaceCheckoutMetadataSchema } from "./schema";

/**
 * Marketplace M5 — Test für `marketplaceCheckoutMetadataSchema`
 * (`src/lib/stripe/schema.ts`), das neue, zusätzliche Schema für
 * Marketplace-Checkout-Sessions. Kein bestehendes `stripe/schema.test.ts`
 * gefunden (siehe Kopfkommentar `marketplace/schema.test.ts`) — diese Datei
 * deckt bewusst nur das NEUE Schema ab, nicht rückwirkend das gesamte
 * bestehende `productFormSchema`/`checkoutMetadataSchema` (außerhalb des
 * Auftrags dieses Blocks).
 */

const VALID_UUID_A = "11111111-1111-1111-1111-111111111111";
const VALID_UUID_B = "22222222-2222-2222-2222-222222222222";
const VALID_UUID_C = "33333333-3333-3333-3333-333333333333";
const VALID_UUID_D = "44444444-4444-4444-4444-444444444444";

describe("marketplaceCheckoutMetadataSchema", () => {
  it("akzeptiert vollständige, gültige Marketplace-Metadata", () => {
    const result = marketplaceCheckoutMetadataSchema.safeParse({
      tenant_id: VALID_UUID_A,
      product_id: VALID_UUID_B,
      user_id: VALID_UUID_C,
      listing_id: VALID_UUID_D,
      source: "marketplace",
    });
    expect(result.success).toBe(true);
  });

  it("lehnt normale (nicht-Marketplace) Checkout-Metadata ab — echte Obermenge, kein loses Schema", () => {
    // Genau das, was `stripe/checkout.ts::createCheckoutSession()` als
    // Metadata setzt — darf NICHT als Marketplace-Kauf durchgehen, sonst
    // würde der Webhook fälschlich handleMarketplacePurchase() aufrufen.
    const result = marketplaceCheckoutMetadataSchema.safeParse({
      tenant_id: VALID_UUID_A,
      product_id: VALID_UUID_B,
      user_id: VALID_UUID_C,
    });
    expect(result.success).toBe(false);
  });

  it("lehnt ein falsches `source`-Literal ab", () => {
    const result = marketplaceCheckoutMetadataSchema.safeParse({
      tenant_id: VALID_UUID_A,
      product_id: VALID_UUID_B,
      user_id: VALID_UUID_C,
      listing_id: VALID_UUID_D,
      source: "shop",
    });
    expect(result.success).toBe(false);
  });

  it("lehnt eine fehlende listing_id ab", () => {
    const result = marketplaceCheckoutMetadataSchema.safeParse({
      tenant_id: VALID_UUID_A,
      product_id: VALID_UUID_B,
      user_id: VALID_UUID_C,
      source: "marketplace",
    });
    expect(result.success).toBe(false);
  });

  it("bleibt eine echte Obermenge: jede gültige Marketplace-Metadata besteht auch checkoutMetadataSchema", () => {
    const parsed = marketplaceCheckoutMetadataSchema.parse({
      tenant_id: VALID_UUID_A,
      product_id: VALID_UUID_B,
      user_id: VALID_UUID_C,
      listing_id: VALID_UUID_D,
      source: "marketplace",
    });
    expect(checkoutMetadataSchema.safeParse(parsed).success).toBe(true);
  });
});
