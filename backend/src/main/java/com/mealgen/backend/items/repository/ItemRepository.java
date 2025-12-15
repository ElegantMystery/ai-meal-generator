package com.mealgen.backend.items.repository;

import com.mealgen.backend.items.model.Item;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface ItemRepository extends JpaRepository<Item, Long> {

    List<Item> findByStoreIgnoreCase(String store);
}
