package com.mealgen.backend.mealplan.service;

import com.mealgen.backend.items.model.Item;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class PackageSizeParserTest {

    private final PackageSizeParser parser = new PackageSizeParser();

    @Test
    void parsesMassUnitsAndDecimalsCaseInsensitively() {
        assertThat(parser.parseUnitSize("1.5 LB")).get()
                .satisfies(size -> {
                    assertThat(size.amount()).isCloseTo(680.388555, within(0.000001));
                    assertThat(size.unit()).isEqualTo("g");
                });
        assertThat(parser.parseUnitSize("12 oz")).get()
                .satisfies(size -> assertThat(size.amount()).isCloseTo(340.1942775, within(0.000001)));
        assertThat(parser.parseUnitSize("250 g")).get()
                .satisfies(size -> assertThat(size.amount()).isEqualTo(250.0));
        assertThat(parser.parseUnitSize("0.5 kg")).get()
                .satisfies(size -> assertThat(size.amount()).isEqualTo(500.0));
    }

    @Test
    void parsesVolumeUnitsWithoutConfusingFluidOuncesWithMass() {
        assertThat(parser.parseUnitSize("12 FL OZ")).get()
                .satisfies(size -> {
                    assertThat(size.amount()).isCloseTo(354.88235475, within(0.000001));
                    assertThat(size.unit()).isEqualTo("ml");
                });
        assertThat(parser.parseUnitSize("750 ml")).get()
                .satisfies(size -> assertThat(size.amount()).isEqualTo(750.0));
        assertThat(parser.parseUnitSize("1 l")).get()
                .satisfies(size -> assertThat(size.amount()).isEqualTo(1000.0));
        assertThat(parser.parseUnitSize("1 pint")).get()
                .satisfies(size -> assertThat(size.amount()).isCloseTo(473.176473, within(0.000001)));
        assertThat(parser.parseUnitSize("1 qt")).get()
                .satisfies(size -> assertThat(size.amount()).isCloseTo(946.352946, within(0.000001)));
        assertThat(parser.parseUnitSize("1 gal")).get()
                .satisfies(size -> assertThat(size.amount()).isCloseTo(3785.411784, within(0.000001)));
    }

    @Test
    void parsesCountAndDozenUnits() {
        assertThat(parser.parseUnitSize("1 each")).get()
                .satisfies(size -> assertThat(size).isEqualTo(new PackageSizeParser.PackageSize(1.0, "count")));
        assertThat(parser.parseUnitSize("6 CT")).get()
                .satisfies(size -> assertThat(size.amount()).isEqualTo(6.0));
        assertThat(parser.parseUnitSize("4 count")).get()
                .satisfies(size -> assertThat(size.amount()).isEqualTo(4.0));
        assertThat(parser.parseUnitSize("1 doz")).get()
                .satisfies(size -> assertThat(size.amount()).isEqualTo(12.0));
        assertThat(parser.parseUnitSize("2 dozen")).get()
                .satisfies(size -> assertThat(size.amount()).isEqualTo(24.0));
    }

    @Test
    void usesUnitSizeFirstThenFallsBackToAnExplicitTrailingNameSize() {
        Item explicit = Item.builder().name("Pasta 2 lb").unitSize("8 oz").build();
        assertThat(parser.parse(explicit)).get()
                .satisfies(size -> assertThat(size.amount()).isCloseTo(226.796185, within(0.000001)));

        Item wholeFoods = Item.builder().name("Organic Spaghetti, 1 LB").unitSize(null).build();
        assertThat(parser.parse(wholeFoods)).get()
                .satisfies(size -> assertThat(size.amount()).isCloseTo(453.59237, within(0.000001)));

        assertThat(parser.parse(Item.builder().name("12 oz Pasta Sauce").build())).isEmpty();
        assertThat(parser.parse(Item.builder().name("Pasta 1 lb family pack").build())).isEmpty();
        assertThat(parser.parse(Item.builder().name("Pasta 1 lb").unitSize("unknown").build())).get()
                .satisfies(size -> assertThat(size.amount()).isCloseTo(453.59237, within(0.000001)));
    }

    @Test
    void rejectsUnparseableNonPositiveAndCompositeValues() {
        assertThat(parser.parseUnitSize(null)).isEmpty();
        assertThat(parser.parseUnitSize("family size")).isEmpty();
        assertThat(parser.parseUnitSize("0 oz")).isEmpty();
        assertThat(parser.parseUnitSize("-1 lb")).isEmpty();
        assertThat(parser.parseUnitSize("2 x 12 oz")).isEmpty();
        assertThat(parser.parseUnitSize("12 floz")).isEmpty();
        assertThat(parser.parse(Item.builder()
                .name("Tomato Juice 6 x 12 fl oz")
                .unitSize(null)
                .build())).isEmpty();
        assertThat(parser.parse(Item.builder()
                .name("Tomato Juice 6 × 12 fl oz")
                .unitSize(null)
                .build())).isEmpty();
    }

    private static org.assertj.core.data.Offset<Double> within(double value) {
        return org.assertj.core.data.Offset.offset(value);
    }
}
