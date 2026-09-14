package com.mealgen.backend.mealplan.service;

import com.mealgen.backend.items.model.Item;

import java.util.Locale;
import java.util.Optional;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Parses retail package sizes into the canonical plan units. */
final class PackageSizeParser {

    private static final String UNIT_PATTERN =
            "fl\\s+oz|dozen|count|each|pint|oz|lb|kg|ml|qt|gal|ct|doz|g|l";
    private static final Pattern UNIT_SIZE = Pattern.compile(
            "^\\s*(\\d+(?:\\.\\d+)?)\\s*(" + UNIT_PATTERN + ")\\s*$",
            Pattern.CASE_INSENSITIVE);
    private static final Pattern TRAILING_NAME_SIZE = Pattern.compile(
            "(?:^|[\\s,(])(?<value>\\d+(?:\\.\\d+)?)\\s*(?<unit>" + UNIT_PATTERN + ")\\s*\\)?\\s*$",
            Pattern.CASE_INSENSITIVE);
    private static final Pattern MULTIPACK_PREFIX = Pattern.compile(
            ".*\\b\\d+(?:\\.\\d+)?\\s*[x×]\\s*$",
            Pattern.CASE_INSENSITIVE);

    Optional<PackageSize> parse(Item item) {
        if (item == null) {
            return Optional.empty();
        }
        String unitSize = item.getUnitSize();
        if (unitSize != null && !unitSize.isBlank()) {
            Optional<PackageSize> parsedUnitSize = parseUnitSize(unitSize);
            if (parsedUnitSize.isPresent()) {
                return parsedUnitSize;
            }
        }
        return parseTrailingNameSize(item.getName());
    }

    Optional<PackageSize> parseUnitSize(String value) {
        if (value == null) {
            return Optional.empty();
        }
        Matcher matcher = UNIT_SIZE.matcher(value);
        return matcher.matches()
                ? canonicalSize(matcher.group(1), matcher.group(2))
                : Optional.empty();
    }

    private Optional<PackageSize> parseTrailingNameSize(String name) {
        if (name == null) {
            return Optional.empty();
        }
        Matcher matcher = TRAILING_NAME_SIZE.matcher(name);
        if (!matcher.find()) {
            return Optional.empty();
        }
        String prefix = name.substring(0, matcher.start());
        if (MULTIPACK_PREFIX.matcher(prefix).matches()) {
            return Optional.empty();
        }
        return canonicalSize(matcher.group("value"), matcher.group("unit"));
    }

    private Optional<PackageSize> canonicalSize(String rawAmount, String rawUnit) {
        double amount;
        try {
            amount = Double.parseDouble(rawAmount);
        } catch (NumberFormatException ignored) {
            return Optional.empty();
        }
        if (!Double.isFinite(amount) || amount <= 0) {
            return Optional.empty();
        }

        String unit = rawUnit.toLowerCase(Locale.ROOT).replaceAll("\\s+", " ");
        return switch (unit) {
            case "g" -> size(amount, "g");
            case "kg" -> size(amount * 1_000.0, "g");
            case "oz" -> size(amount * 28.349523125, "g");
            case "lb" -> size(amount * 453.59237, "g");
            case "ml" -> size(amount, "ml");
            case "l" -> size(amount * 1_000.0, "ml");
            case "fl oz" -> size(amount * 29.5735295625, "ml");
            case "pint" -> size(amount * 473.176473, "ml");
            case "qt" -> size(amount * 946.352946, "ml");
            case "gal" -> size(amount * 3_785.411784, "ml");
            case "each", "ct", "count" -> size(amount, "count");
            case "doz", "dozen" -> size(amount * 12.0, "count");
            default -> Optional.empty();
        };
    }

    private Optional<PackageSize> size(double amount, String unit) {
        return Double.isFinite(amount) && amount > 0
                ? Optional.of(new PackageSize(amount, unit))
                : Optional.empty();
    }

    record PackageSize(double amount, String unit) {
    }
}
