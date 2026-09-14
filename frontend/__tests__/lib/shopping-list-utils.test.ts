import {
  buildShoppingListClipboardText,
  formatShoppingQuantityDetails,
  type ShoppingListItem,
} from "@/lib/shopping-list-utils";

const exactItem: ShoppingListItem = {
  id: 1,
  name: "Spaghetti",
  qty: 1,
  price: 2.49,
  unitSize: "1 Lb",
  neededAmount: 170,
  neededUnit: "g",
  quantityEstimated: false,
};

describe("formatShoppingQuantityDetails", () => {
  it("shows the needed amount and purchasable packages for an exact quantity", () => {
    expect(formatShoppingQuantityDetails(exactItem)).toBe(
      "Need 170 g · 1 × 1 Lb",
    );
  });

  it("labels fallback quantities as estimated", () => {
    expect(
      formatShoppingQuantityDetails({
        id: 2,
        name: "Loose Produce",
        qty: 1,
        unitSize: null,
        neededAmount: 2,
        neededUnit: "count",
        quantityEstimated: true,
      }),
    ).toBe("Need 2 count · 1 package · Quantity estimated");
  });

  it("keeps a useful legacy package label without a needed amount", () => {
    expect(
      formatShoppingQuantityDetails({
        id: 3,
        name: "Legacy Pasta",
        qty: 2,
        unitSize: "1 lb",
      }),
    ).toBe("2 × 1 lb");
  });
});

describe("buildShoppingListClipboardText", () => {
  it("includes needed amounts and package quantities", () => {
    expect(buildShoppingListClipboardText([exactItem])).toBe(
      "1x Spaghetti - 1 Lb - need 170 g ($2.49)",
    );
  });

  it("marks estimated fallback quantities in copied text", () => {
    expect(
      buildShoppingListClipboardText([
        {
          id: 2,
          name: "Loose Produce",
          qty: 1,
          quantityEstimated: true,
        },
      ]),
    ).toBe("1x Loose Produce - quantity estimated");
  });
});
