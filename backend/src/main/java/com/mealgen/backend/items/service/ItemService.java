package com.mealgen.backend.items.service;

import com.mealgen.backend.items.model.Item;
import com.mealgen.backend.items.repository.ItemRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
@RequiredArgsConstructor
public class ItemService {

    private final ItemRepository itemRepository;

    public List<Item> getItemsByStore(String store) {
        return itemRepository.findByStoreIgnoreCase(store);
    }

    public List<Item> getAllItems() {
        return itemRepository.findAll();
    }

    @Transactional
    public Item createItem(Item item) {
        return itemRepository.save(item);
    }

    public long countItems() {
        return itemRepository.count();
    }
}
