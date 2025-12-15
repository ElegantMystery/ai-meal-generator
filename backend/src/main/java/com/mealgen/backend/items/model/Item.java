package com.mealgen.backend.items.model;

import jakarta.persistence.*;
import lombok.*;

@Entity
@Table(
    name = "items",
    uniqueConstraints = @UniqueConstraint(name = "uq_items_store_external", columnNames = {"store", "externalId"})
)
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class Item {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /**
     * Store identifier: e.g. "COSTCO" or "TRADER_JOES"
     */
    @Column(nullable = false)
    private String store;

    @Column(nullable = false)
    private String name;

    @Column(nullable = false)
    private String externalId; // TJ or COSTCO SKU

    private Double price;     // SKU price

    private String unitSize;  // e.g. "12 oz", "1 lb", "1 kg"

    /**
     * Category path, e.g. "Food > Fresh Prepared Foods > Dessert & Sweets" for TJ
     */
    private String categoryPath;

    /**
     *  e.g. "/content/dam/trjo/products/m20501/53094.png" for TJ
     *  Need to prepend the base URL to get the full image URL for TJ
     */
    private String imageUrl; 

    @Column(columnDefinition = "jsonb")
    private String tagsJson;   // store fun_tags + item_characteristics, etc.

    @Column(columnDefinition = "jsonb")
    private String rawJson;    // store full scraped raw payload
}
