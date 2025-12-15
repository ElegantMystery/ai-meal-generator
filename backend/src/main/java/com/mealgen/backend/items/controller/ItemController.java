package com.mealgen.backend.items.controller;

import com.mealgen.backend.items.model.Item;
import com.mealgen.backend.items.service.ItemService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/items")
@RequiredArgsConstructor
public class ItemController {

    private final ItemService itemService;

    @GetMapping
    public List<Item> allItems(
            @RequestParam(value = "store", required = false) String store
    ) {
        if (store == null || store.isBlank()) {
            return itemService.getAllItems();
        }
        return itemService.getItemsByStore(store);
    }

    @GetMapping("/costco")
    public List<Item> costcoItems() {
        return itemService.getItemsByStore("COSTCO");
    }

    @GetMapping("/traderjoes")
    public List<Item> traderJoesItems() {
        return itemService.getItemsByStore("TRADER_JOES");
    }

    // Simple create endpoint for testing / manual seeding via Postman
    @PostMapping
    public Item create(@RequestBody Item item) {
        return itemService.createItem(item);
    }
}
