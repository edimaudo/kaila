"""Curated text-led screen-style references. No show stills or celebrity photos are reused."""
from __future__ import annotations

SCREEN_STYLES: list[dict] = [
    {
        "id": "quiet-luxury-drama", "title": "Quiet luxury drama", "show": "Prestige drama", "kind": "Screen-inspired",
        "description": "Understated tailoring, fine knits, long coats and a restrained neutral palette.",
        "aesthetic": ["classic", "minimal", "workwear"], "categories": ["Outerwear", "Knitwear", "Trousers", "Bags"],
        "colours": ["camel", "black", "cream", "charcoal"], "occasions": ["work", "everyday", "event"],
        "tags": ["tailoring", "quiet luxury", "minimal", "structured", "polished"],
        "source_name": "Editorial search", "source_url": "https://www.google.com/search?q=quiet+luxury+screen+style+outfits",
        "art_direction": "stone", "image_url": "https://images.unsplash.com/photo-1539533018447-63fcce2678e3?auto=format&fit=crop&w=960&q=82",
    },
    {
        "id": "romantic-period", "title": "Modern romantic period", "show": "Period romance", "kind": "Screen-inspired",
        "description": "Soft structure, flowing shapes, delicate details and modern pastel or jewel accents.",
        "aesthetic": ["romantic", "classic", "creative"], "categories": ["Dresses", "Blouses", "Knitwear", "Jewellery"],
        "colours": ["blush", "cream", "blue", "plum"], "occasions": ["event", "weekend", "everyday"],
        "tags": ["romantic", "soft", "flowing", "dress", "feminine"],
        "source_name": "Editorial search", "source_url": "https://www.google.com/search?q=modern+period+romance+inspired+fashion",
        "art_direction": "rose", "image_url": "https://images.unsplash.com/photo-1529139574466-a303027c1d8b?auto=format&fit=crop&w=960&q=82",
    },
    {
        "id": "city-colour", "title": "Colourful city dressing", "show": "Contemporary city comedy", "kind": "Screen-inspired",
        "description": "Confident colour, playful accessories, statement separates and outfit-building layers.",
        "aesthetic": ["creative", "trendy", "classic"], "categories": ["Jackets", "Tops", "Skirts", "Bags", "Shoes"],
        "colours": ["red", "cobalt", "pink", "green", "white"], "occasions": ["work", "weekend", "event", "travel"],
        "tags": ["colour", "statement", "city", "playful", "accessories"],
        "source_name": "Editorial search", "source_url": "https://www.google.com/search?q=colourful+city+fashion+inspiration",
        "art_direction": "cobalt", "image_url": "https://images.unsplash.com/photo-1483985988355-763728e1935b?auto=format&fit=crop&w=960&q=82",
    },
    {
        "id": "off-duty-minimal", "title": "Off-duty minimal", "show": "Celebrity street-style aesthetic", "kind": "Style archetype",
        "description": "Relaxed denim, clean basics, easy outerwear and a small number of intentional accessories.",
        "aesthetic": ["minimal", "casual", "classic"], "categories": ["Denim", "T-shirts", "Outerwear", "Sneakers", "Bags"],
        "colours": ["black", "white", "blue", "grey", "denim"], "occasions": ["everyday", "weekend", "travel"],
        "tags": ["casual", "off-duty", "denim", "layering", "minimal"],
        "source_name": "Street-style search", "source_url": "https://www.google.com/search?q=celebrity+off+duty+street+style+outfits",
        "art_direction": "slate", "image_url": "https://images.unsplash.com/photo-1525507119028-ed4c629a60a3?auto=format&fit=crop&w=960&q=82",
    },
    {
        "id": "dark-academic", "title": "Dark academic", "show": "Gothic mystery aesthetic", "kind": "Screen-inspired",
        "description": "Dark layers, sharp collars, pleated shapes and texture-led monochrome outfits.",
        "aesthetic": ["edgy", "classic", "minimal"], "categories": ["Knitwear", "Blazers", "Trousers", "Skirts", "Boots"],
        "colours": ["black", "charcoal", "burgundy", "white"], "occasions": ["work", "everyday", "event"],
        "tags": ["dark", "academic", "gothic", "monochrome", "structured"],
        "source_name": "Editorial search", "source_url": "https://www.google.com/search?q=dark+academic+fashion+outfits",
        "art_direction": "ink", "image_url": "https://images.unsplash.com/photo-1485230895905-ec40ba36b9bc?auto=format&fit=crop&w=960&q=82",
    },
    {
        "id": "sporty-prep", "title": "Sporty prep", "show": "Modern workplace comedy", "kind": "Style archetype",
        "description": "Polished casual layers, knitwear, relaxed tailoring, trainers and varsity-inspired details.",
        "aesthetic": ["preppy", "sporty", "casual"], "categories": ["Knitwear", "Jackets", "Chinos", "Sneakers", "Caps"],
        "colours": ["navy", "cream", "green", "red"], "occasions": ["everyday", "work", "weekend", "travel"],
        "tags": ["preppy", "sporty", "casual", "knit", "layering"],
        "source_name": "Editorial search", "source_url": "https://www.google.com/search?q=sporty+preppy+street+style+outfits",
        "art_direction": "navy", "image_url": "https://images.unsplash.com/photo-1487222477894-8943e31ef7b2?auto=format&fit=crop&w=960&q=82",
    },
    {
        "id": "elevated-workwear", "title": "Elevated workwear", "show": "Contemporary restaurant drama", "kind": "Screen-inspired",
        "description": "Practical layers, durable textures, relaxed trousers and functional accessories.",
        "aesthetic": ["workwear", "casual", "minimal"], "categories": ["Overshirts", "Trousers", "Knitwear", "Boots", "Bags"],
        "colours": ["olive", "brown", "black", "cream", "denim"], "occasions": ["everyday", "work", "weekend"],
        "tags": ["workwear", "utility", "layers", "practical", "relaxed"],
        "source_name": "Editorial search", "source_url": "https://www.google.com/search?q=elevated+workwear+outfit+inspiration",
        "art_direction": "olive", "image_url": "https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=960&q=82",
    },
    {
        "id": "soft-tailoring", "title": "Soft tailoring", "show": "Modern romantic minimalism", "kind": "Style archetype",
        "description": "Easy blazers, fluid trousers, fine-gauge layers and tonal styling that works across occasions.",
        "aesthetic": ["classic", "minimal", "romantic"], "categories": ["Blazers", "Trousers", "Tops", "Loafers", "Bags"],
        "colours": ["cream", "taupe", "navy", "grey", "brown"], "occasions": ["work", "everyday", "event", "travel"],
        "tags": ["tailored", "soft", "tonal", "polished", "versatile"],
        "source_name": "Editorial search", "source_url": "https://www.google.com/search?q=soft+tailoring+outfit+inspiration",
        "art_direction": "sand", "image_url": "https://images.unsplash.com/photo-1485968579580-b6d095142e6e?auto=format&fit=crop&w=960&q=82",
    },
]


def get_screen_style(style_id: str) -> dict | None:
    return next((style for style in SCREEN_STYLES if style["id"] == style_id), None)
