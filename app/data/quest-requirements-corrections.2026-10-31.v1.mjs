// RuneScape Wiki facts from pinned revisions. Prepared-row overlays preserve immutable packs and existing task identities.
export default {
  "schemaVersion": 1,
  "id": "quest-requirements-qfix1",
  "version": "2026-10-31.v1",
  "reviewedOn": "2026-10-31",
  "patches": [
    {
      "path": [
        "challenges",
        "Nonskill",
        "Kili's Knowledge III: mogre flippers"
      ],
      "beforePresent": false,
      "afterPresent": true,
      "after": {
        "PickerId": "rs3:task:qfix1-kili-s-knowledge-iii-mogre-flippers",
        "BaseQuest": "Kili's Knowledge",
        "Description": "Kill mogres with necromancy and deliver the necromancer's flippers; urn filling is a separate requirement.",
        "Skills": {
          "Slayer": 32
        },
        "Monsters": [
          "Mogre"
        ],
        "Items": [
          "Necromancer's flippers"
        ]
      },
      "findings": [
        "H01"
      ],
      "evidence": {
        "title": "Kili's Knowledge III",
        "revision": 37079288,
        "url": "https://runescape.wiki/w/Special:PermanentLink/37079288"
      },
      "reason": "The existing flippers source and mogre are declared; Slayer is boostable independently of Necromancy."
    },
    {
      "path": [
        "challenges",
        "Quest",
        "~|Kili's Knowledge|~ III"
      ],
      "beforePresent": true,
      "before": {
        "BaseQuest": "Kili's Knowledge",
        "Description": "Learn how to make t50 necromancy equipment.",
        "Chunks": [
          "11824",
          "City of Um"
        ],
        "Items": [
          "Apple pie",
          "Fishing explosive"
        ],
        "Tasks": {
          "SoulUrnIII[+]": "Nonskill",
          "~|Kili's Knowledge|~ II": "Quest",
          "~|Mogre (lore activity)|~ Complete the lore activity": "Quest"
        },
        "Skills": {
          "Necromancy": 50
        },
        "Not F2P": true,
        "NoBoost": true
      },
      "beforeRecordSha256": "cf6c9e9eb9d8a9ec1a63a42b24d502cad28f266a5f8d69fbd19fa934c7e63055",
      "afterPresent": true,
      "after": {
        "BaseQuest": "Kili's Knowledge",
        "Description": "Learn how to make t50 necromancy equipment.",
        "Chunks": [
          "11824",
          "City of Um"
        ],
        "Items": [
          "Apple pie",
          "Fishing explosive"
        ],
        "Tasks": {
          "SoulUrnIII[+]": "Nonskill",
          "~|Kili's Knowledge|~ II": "Quest",
          "~|Mogre (lore activity)|~ Complete the lore activity": "Quest",
          "Kili's Knowledge III: mogre flippers": "Nonskill"
        },
        "Skills": {
          "Necromancy": 50
        },
        "Not F2P": true,
        "NoBoost": true
      },
      "findings": [
        "H01"
      ],
      "evidence": {
        "title": "Kili's Knowledge III",
        "revision": 37079288,
        "url": "https://runescape.wiki/w/Special:PermanentLink/37079288"
      },
      "reason": "Keep Necromancy 50 unboostable and require the separate mogre/flippers gate as well as either urn route."
    },
    {
      "path": [
        "challenges",
        "Quest",
        "~|Barbarian Training|~ 2b4a1"
      ],
      "beforePresent": true,
      "before": {
        "BaseQuest": "Barbarian Training",
        "Description": "Catch a tuna barehanded",
        "Objects": [
          "Fishing spot (cage, harpoon)"
        ],
        "Tasks": {
          "~|Barbarian Training|~ 2b3": "Quest"
        },
        "Skills": {
          "Fishing": 55,
          "Strength": 55
        },
        "Not F2P": true
      },
      "beforeRecordSha256": "d2982da0a664e13b3a25c651331fa20be371cb2de28c5b02029832d93526085c",
      "afterPresent": true,
      "after": {
        "BaseQuest": "Barbarian Training",
        "Description": "Catch a tuna barehanded",
        "Objects": [
          "Fishing spot (cage, harpoon)"
        ],
        "Tasks": {
          "~|Barbarian Training|~ 2b3": "Quest"
        },
        "Skills": {
          "Fishing": 55,
          "Strength": 35
        },
        "Not F2P": true
      },
      "findings": [
        "H02"
      ],
      "evidence": [
        {
          "title": "Barbarian Training",
          "revision": 37177864,
          "url": "https://runescape.wiki/w/Special:PermanentLink/37177864"
        },
        {
          "title": "Barbarian Fishing",
          "revision": 37197153,
          "url": "https://runescape.wiki/w/Special:PermanentLink/37197153"
        }
      ],
      "reason": "Barehanded tuna requires Strength 35 and Fishing 55."
    },
    {
      "path": [
        "challenges",
        "Nonskill",
        "Barbarian training smithing: bronze"
      ],
      "beforePresent": false,
      "afterPresent": true,
      "after": {
        "PickerId": "rs3:task:qfix1-barbarian-training-smithing-bronze",
        "BaseQuest": "Barbarian Training",
        "Skills": {
          "Smithing": 5
        },
        "Items": [
          "Bronze bar",
          "Logs"
        ]
      },
      "findings": [
        "H03"
      ],
      "evidence": [
        {
          "title": "Barbarian Training",
          "revision": 37177864,
          "url": "https://runescape.wiki/w/Special:PermanentLink/37177864"
        },
        {
          "title": "Barbarian Smithing",
          "revision": 37177861,
          "url": "https://runescape.wiki/w/Special:PermanentLink/37177861"
        }
      ],
      "reason": "One corresponding metal/log/level recipe; alternatives must not mix recipes."
    },
    {
      "path": [
        "challenges",
        "Nonskill",
        "Barbarian training smithing: iron"
      ],
      "beforePresent": false,
      "afterPresent": true,
      "after": {
        "PickerId": "rs3:task:qfix1-barbarian-training-smithing-iron",
        "BaseQuest": "Barbarian Training",
        "Skills": {
          "Smithing": 10
        },
        "Items": [
          "Iron bar",
          "Oak logs"
        ]
      },
      "findings": [
        "H03"
      ],
      "evidence": [
        {
          "title": "Barbarian Training",
          "revision": 37177864,
          "url": "https://runescape.wiki/w/Special:PermanentLink/37177864"
        },
        {
          "title": "Barbarian Smithing",
          "revision": 37177861,
          "url": "https://runescape.wiki/w/Special:PermanentLink/37177861"
        }
      ],
      "reason": "One corresponding metal/log/level recipe; alternatives must not mix recipes."
    },
    {
      "path": [
        "challenges",
        "Nonskill",
        "Barbarian training smithing: steel"
      ],
      "beforePresent": false,
      "afterPresent": true,
      "after": {
        "PickerId": "rs3:task:qfix1-barbarian-training-smithing-steel",
        "BaseQuest": "Barbarian Training",
        "Skills": {
          "Smithing": 20
        },
        "Items": [
          "Steel bar",
          "Willow logs"
        ]
      },
      "findings": [
        "H03"
      ],
      "evidence": [
        {
          "title": "Barbarian Training",
          "revision": 37177864,
          "url": "https://runescape.wiki/w/Special:PermanentLink/37177864"
        },
        {
          "title": "Barbarian Smithing",
          "revision": 37177861,
          "url": "https://runescape.wiki/w/Special:PermanentLink/37177861"
        }
      ],
      "reason": "One corresponding metal/log/level recipe; alternatives must not mix recipes."
    },
    {
      "path": [
        "challenges",
        "Nonskill",
        "Barbarian training smithing: mithril"
      ],
      "beforePresent": false,
      "afterPresent": true,
      "after": {
        "PickerId": "rs3:task:qfix1-barbarian-training-smithing-mithril",
        "BaseQuest": "Barbarian Training",
        "Skills": {
          "Smithing": 30
        },
        "Items": [
          "Mithril bar",
          "Maple logs"
        ]
      },
      "findings": [
        "H03"
      ],
      "evidence": [
        {
          "title": "Barbarian Training",
          "revision": 37177864,
          "url": "https://runescape.wiki/w/Special:PermanentLink/37177864"
        },
        {
          "title": "Barbarian Smithing",
          "revision": 37177861,
          "url": "https://runescape.wiki/w/Special:PermanentLink/37177861"
        }
      ],
      "reason": "One corresponding metal/log/level recipe; alternatives must not mix recipes."
    },
    {
      "path": [
        "challenges",
        "Nonskill",
        "Barbarian training smithing: adamant"
      ],
      "beforePresent": false,
      "afterPresent": true,
      "after": {
        "PickerId": "rs3:task:qfix1-barbarian-training-smithing-adamant",
        "BaseQuest": "Barbarian Training",
        "Skills": {
          "Smithing": 40
        },
        "Items": [
          "Adamant bar",
          "Yew logs"
        ]
      },
      "findings": [
        "H03"
      ],
      "evidence": [
        {
          "title": "Barbarian Training",
          "revision": 37177864,
          "url": "https://runescape.wiki/w/Special:PermanentLink/37177864"
        },
        {
          "title": "Barbarian Smithing",
          "revision": 37177861,
          "url": "https://runescape.wiki/w/Special:PermanentLink/37177861"
        }
      ],
      "reason": "One corresponding metal/log/level recipe; alternatives must not mix recipes."
    },
    {
      "path": [
        "challenges",
        "Nonskill",
        "Barbarian training smithing: rune"
      ],
      "beforePresent": false,
      "afterPresent": true,
      "after": {
        "PickerId": "rs3:task:qfix1-barbarian-training-smithing-rune",
        "BaseQuest": "Barbarian Training",
        "Skills": {
          "Smithing": 50
        },
        "Items": [
          "Rune bar",
          "Magic logs"
        ]
      },
      "findings": [
        "H03"
      ],
      "evidence": [
        {
          "title": "Barbarian Training",
          "revision": 37177864,
          "url": "https://runescape.wiki/w/Special:PermanentLink/37177864"
        },
        {
          "title": "Barbarian Smithing",
          "revision": 37177861,
          "url": "https://runescape.wiki/w/Special:PermanentLink/37177861"
        }
      ],
      "reason": "One corresponding metal/log/level recipe; alternatives must not mix recipes."
    },
    {
      "path": [
        "codeItems",
        "tasksPlus",
        "BarbarianTrainingSmithingRoute[+]"
      ],
      "beforePresent": false,
      "afterPresent": true,
      "after": [
        "Barbarian training smithing: bronze",
        "Barbarian training smithing: iron",
        "Barbarian training smithing: steel",
        "Barbarian training smithing: mithril",
        "Barbarian training smithing: adamant",
        "Barbarian training smithing: rune"
      ],
      "findings": [
        "H03"
      ],
      "evidence": [
        {
          "title": "Barbarian Training",
          "revision": 37177864,
          "url": "https://runescape.wiki/w/Special:PermanentLink/37177864"
        },
        {
          "title": "Barbarian Smithing",
          "revision": 37177861,
          "url": "https://runescape.wiki/w/Special:PermanentLink/37177861"
        }
      ],
      "reason": "Any complete smithable-metal recipe, shared by spear and hasta training without the post-training hasta dependency."
    },
    {
      "path": [
        "challenges",
        "Quest",
        "~|Barbarian Training|~ 2b4a4"
      ],
      "beforePresent": true,
      "before": {
        "BaseQuest": "Barbarian Training",
        "Description": "Smith a steel spear",
        "Chunks": [
          "10038-2"
        ],
        "Items": [
          "Steel bar",
          "Willow logs"
        ],
        "Tasks": {
          "~|Barbarian Training|~ 2b4a3": "Quest"
        },
        "Skills": {
          "Smithing": 20
        },
        "Not F2P": true
      },
      "beforeRecordSha256": "ed455268b375ae6199402f5ce815e8c7a3b24334a8338095bd0dd22acaed82b4",
      "afterPresent": true,
      "after": {
        "BaseQuest": "Barbarian Training",
        "Description": "Smith a spear using any corresponding metal and logs",
        "Chunks": [
          "10038-2"
        ],
        "Tasks": {
          "~|Barbarian Training|~ 2b4a3": "Quest",
          "BarbarianTrainingSmithingRoute[+]": "Nonskill"
        },
        "Not F2P": true
      },
      "findings": [
        "H03"
      ],
      "evidence": [
        {
          "title": "Barbarian Training",
          "revision": 37177864,
          "url": "https://runescape.wiki/w/Special:PermanentLink/37177864"
        },
        {
          "title": "Barbarian Smithing",
          "revision": 37177861,
          "url": "https://runescape.wiki/w/Special:PermanentLink/37177861"
        }
      ],
      "reason": "Use a complete corresponding metal/log/level route; retain the original task identity and forge location."
    },
    {
      "path": [
        "challenges",
        "Quest",
        "~|Barbarian Training|~ 2b4a6"
      ],
      "beforePresent": true,
      "before": {
        "BaseQuest": "Barbarian Training",
        "Description": "Smith a steel hasta",
        "Chunks": [
          "10038-2"
        ],
        "Items": [
          "Steel bar",
          "Willow logs"
        ],
        "Tasks": {
          "~|Barbarian Training|~ 2b4a5": "Quest"
        },
        "Skills": {
          "Smithing": 20
        },
        "Not F2P": true
      },
      "beforeRecordSha256": "c4dc53107a6e66a73179a438d82c5c5e7eb5356c94d0e6602c892f5de5ae54d6",
      "afterPresent": true,
      "after": {
        "BaseQuest": "Barbarian Training",
        "Description": "Smith a hasta using any corresponding metal and logs",
        "Chunks": [
          "10038-2"
        ],
        "Tasks": {
          "~|Barbarian Training|~ 2b4a5": "Quest",
          "BarbarianTrainingSmithingRoute[+]": "Nonskill"
        },
        "Not F2P": true
      },
      "findings": [
        "H03"
      ],
      "evidence": [
        {
          "title": "Barbarian Training",
          "revision": 37177864,
          "url": "https://runescape.wiki/w/Special:PermanentLink/37177864"
        },
        {
          "title": "Barbarian Smithing",
          "revision": 37177861,
          "url": "https://runescape.wiki/w/Special:PermanentLink/37177861"
        }
      ],
      "reason": "Use a complete corresponding metal/log/level route; retain the original task identity and forge location."
    },
    {
      "path": [
        "challenges",
        "Nonskill",
        "Cold War: obtain cowbells by thieving"
      ],
      "beforePresent": false,
      "afterPresent": true,
      "after": {
        "PickerId": "rs3:task:qfix1-cold-war-obtain-cowbells-by-thieving",
        "BaseQuest": "Cold War",
        "Skills": {
          "Thieving": 15
        }
      },
      "findings": [
        "H04",
        "H05"
      ],
      "evidence": {
        "title": "Cold War",
        "revision": 37221914,
        "url": "https://runescape.wiki/w/Special:PermanentLink/37221914"
      },
      "reason": "The Thieving route permits boosts."
    },
    {
      "path": [
        "challenges",
        "Nonskill",
        "Cold War: obtain cowbells in Zanaris"
      ],
      "beforePresent": false,
      "afterPresent": true,
      "after": {
        "PickerId": "rs3:task:qfix1-cold-war-obtain-cowbells-in-zanaris",
        "BaseQuest": "Cold War",
        "Chunks": [
          "Zanaris"
        ]
      },
      "findings": [
        "H04",
        "H05"
      ],
      "evidence": {
        "title": "Cold War",
        "revision": 37221914,
        "url": "https://runescape.wiki/w/Special:PermanentLink/37221914"
      },
      "reason": "Access to Zanaris is the non-Thieving route."
    },
    {
      "path": [
        "codeItems",
        "tasksPlus",
        "ColdWarCowbellRoute[+]"
      ],
      "beforePresent": false,
      "afterPresent": true,
      "after": [
        "Cold War: obtain cowbells by thieving",
        "Cold War: obtain cowbells in Zanaris"
      ],
      "findings": [
        "H04",
        "H05"
      ],
      "evidence": {
        "title": "Cold War",
        "revision": 37221914,
        "url": "https://runescape.wiki/w/Special:PermanentLink/37221914"
      },
      "reason": "Either route suffices; no unrelated base skill is made boostable."
    },
    {
      "path": [
        "challenges",
        "Quest",
        "~|Cold War|~ 1"
      ],
      "beforePresent": true,
      "before": {
        "BaseQuest": "Cold War",
        "Description": "Talk to Larry",
        "Chunks": [
          "10291"
        ],
        "Skills": {
          "Hunter": 10,
          "Construction": 34,
          "Crafting": 30,
          "Agility": 30,
          "Thieving": 15
        },
        "Not F2P": true,
        "NoBoost": true
      },
      "beforeRecordSha256": "b2147dc4d9e1eac541add87b92369c7b3120ba20993b6467a1a146d5721a6ef9",
      "afterPresent": true,
      "after": {
        "BaseQuest": "Cold War",
        "Description": "Talk to Larry",
        "Chunks": [
          "10291"
        ],
        "Skills": {
          "Hunter": 10,
          "Construction": 34,
          "Crafting": 30,
          "Agility": 30
        },
        "Not F2P": true,
        "NoBoost": true,
        "Tasks": {
          "ColdWarCowbellRoute[+]": "Nonskill"
        }
      },
      "findings": [
        "H04",
        "H05"
      ],
      "evidence": {
        "title": "Cold War",
        "revision": 37221914,
        "url": "https://runescape.wiki/w/Special:PermanentLink/37221914"
      },
      "reason": "Move only Thieving into the boostable OR route; retain the other unboostable prerequisites."
    },
    {
      "path": [
        "codeItems",
        "itemsPlus",
        "ColdWarPenguinDistraction[+]"
      ],
      "beforePresent": false,
      "afterPresent": true,
      "after": [
        "Raw cod",
        "Ring of charos",
        "Ring of charos (a)"
      ],
      "findings": [
        "H06"
      ],
      "evidence": {
        "title": "Cold War",
        "revision": 37221914,
        "url": "https://runescape.wiki/w/Special:PermanentLink/37221914"
      },
      "reason": "Raw cod or either declared ring variant, including the inactive ring."
    },
    {
      "path": [
        "challenges",
        "Quest",
        "~|Cold War|~ 10"
      ],
      "beforePresent": true,
      "before": {
        "BaseQuest": "Cold War",
        "Description": "Talk to the penguins in Ardougne Zoo",
        "Chunks": [
          "10291"
        ],
        "Items": [
          "Raw cod"
        ],
        "Tasks": {
          "~|Cold War|~ 9": "Quest"
        },
        "Not F2P": true
      },
      "beforeRecordSha256": "605dec4f3b6ba3e385e90244d58a54ae652672627b8e36652c746815cd574a3b",
      "afterPresent": true,
      "after": {
        "BaseQuest": "Cold War",
        "Description": "Talk to the penguins in Ardougne Zoo",
        "Chunks": [
          "10291"
        ],
        "Items": [
          "ColdWarPenguinDistraction[+]"
        ],
        "Tasks": {
          "~|Cold War|~ 9": "Quest"
        },
        "Not F2P": true
      },
      "findings": [
        "H06"
      ],
      "evidence": {
        "title": "Cold War",
        "revision": 37221914,
        "url": "https://runescape.wiki/w/Special:PermanentLink/37221914"
      },
      "reason": "Permit the inactive or active ring as an alternative to raw cod."
    },
    {
      "path": [
        "challenges",
        "Quest",
        "~|Recipe for Disaster: Freeing Evil Dave|~ 1"
      ],
      "beforePresent": true,
      "before": {
        "BaseQuest": "Recipe for Disaster: Freeing Evil Dave",
        "Description": "Inspect Evil Dave",
        "Chunks": [
          "12850-1"
        ],
        "Tasks": {
          "~|Recipe for Disaster: Another Cook's Quest|~ Complete the subquest": "Quest",
          "~|Gertrude's Cat|~ Complete the quest": "Quest",
          "~|Shadow of the Storm|~ Complete the quest": "Quest"
        },
        "Skills": {
          "Cooking": 25
        },
        "Not F2P": true
      },
      "beforeRecordSha256": "c909f27cc4206a742ea910f5fc536378dc9542973dae0c1d713d0e19691800e7",
      "afterPresent": true,
      "after": {
        "BaseQuest": "Recipe for Disaster: Freeing Evil Dave",
        "Description": "Inspect Evil Dave",
        "Chunks": [
          "12850-1"
        ],
        "Tasks": {
          "~|Recipe for Disaster: Another Cook's Quest|~ Complete the subquest": "Quest",
          "~|Gertrude's Cat|~ Complete the quest": "Quest",
          "~|Shadow of the Storm|~ Complete the quest": "Quest"
        },
        "Not F2P": true
      },
      "findings": [
        "H07"
      ],
      "evidence": {
        "title": "Recipe for Disaster: Freeing Evil Dave",
        "revision": 37219053,
        "url": "https://runescape.wiki/w/Special:PermanentLink/37219053"
      },
      "reason": "Cooking 25 is explicitly not a prerequisite; stew supply remains separate."
    },
    {
      "path": [
        "challenges",
        "Nonskill",
        "Recipe for Disaster: Freeing King Awowogei: boostable Cooking gate"
      ],
      "beforePresent": false,
      "afterPresent": true,
      "after": {
        "PickerId": "rs3:task:qfix1-recipe-for-disaster-freeing-king-awowogei-boostable-cooking-gate",
        "BaseQuest": "Recipe for Disaster: Freeing King Awowogei",
        "Skills": {
          "Cooking": 70
        }
      },
      "findings": [
        "H08"
      ],
      "evidence": {
        "title": "Recipe for Disaster: Freeing King Awowogei",
        "revision": 37153517,
        "url": "https://runescape.wiki/w/Special:PermanentLink/37153517"
      },
      "reason": "Separate the named boostable skill from the unchanged unboostable skills."
    },
    {
      "path": [
        "challenges",
        "Quest",
        "~|Recipe for Disaster: Freeing King Awowogei|~ 1"
      ],
      "beforePresent": true,
      "before": {
        "BaseQuest": "Recipe for Disaster: Freeing King Awowogei",
        "Description": "Inspect King Awowogei",
        "Chunks": [
          "12850-1"
        ],
        "Tasks": {
          "~|Recipe for Disaster: Another Cook's Quest|~ Complete the subquest": "Quest",
          "~|Monkey Madness|~ Complete the quest": "Quest"
        },
        "Skills": {
          "Agility": 48,
          "Cooking": 70
        },
        "Not F2P": true,
        "NoBoost": true
      },
      "beforeRecordSha256": "58822ba9090ee88cb5a28e18fcc23cd638b1c87d02d09ac413bf464a45d3597e",
      "afterPresent": true,
      "after": {
        "BaseQuest": "Recipe for Disaster: Freeing King Awowogei",
        "Description": "Inspect King Awowogei",
        "Chunks": [
          "12850-1"
        ],
        "Tasks": {
          "~|Recipe for Disaster: Another Cook's Quest|~ Complete the subquest": "Quest",
          "~|Monkey Madness|~ Complete the quest": "Quest",
          "Recipe for Disaster: Freeing King Awowogei: boostable Cooking gate": "Nonskill"
        },
        "Skills": {
          "Agility": 48
        },
        "Not F2P": true,
        "NoBoost": true
      },
      "findings": [
        "H08"
      ],
      "evidence": {
        "title": "Recipe for Disaster: Freeing King Awowogei",
        "revision": 37153517,
        "url": "https://runescape.wiki/w/Special:PermanentLink/37153517"
      },
      "reason": "Allow boosting only the named skills; preserve every other skill gate."
    },
    {
      "path": [
        "challenges",
        "Quest",
        "~|Recipe for Disaster: Freeing Pirate Pete|~ 1"
      ],
      "beforePresent": true,
      "before": {
        "BaseQuest": "Recipe for Disaster: Freeing Pirate Pete",
        "Description": "Inspect Pirate Pete",
        "Chunks": [
          "12850-1"
        ],
        "Tasks": {
          "~|Recipe for Disaster: Another Cook's Quest|~ Complete the subquest": "Quest"
        },
        "Skills": {
          "Cooking": 31
        },
        "Not F2P": true,
        "NoBoost": true
      },
      "beforeRecordSha256": "a19ad1db38b427ec2560027e3c7abcf9212cd2186003715c48ec866c5a124127",
      "afterPresent": true,
      "after": {
        "BaseQuest": "Recipe for Disaster: Freeing Pirate Pete",
        "Description": "Inspect Pirate Pete",
        "Chunks": [
          "12850-1"
        ],
        "Tasks": {
          "~|Recipe for Disaster: Another Cook's Quest|~ Complete the subquest": "Quest"
        },
        "Skills": {
          "Cooking": 31
        },
        "Not F2P": true
      },
      "findings": [
        "H09"
      ],
      "evidence": {
        "title": "Recipe for Disaster: Freeing Pirate Pete",
        "revision": 37219046,
        "url": "https://runescape.wiki/w/Special:PermanentLink/37219046"
      },
      "reason": "Allow boosting only the named skills; preserve every other skill gate."
    },
    {
      "path": [
        "challenges",
        "Quest",
        "~|Recipe for Disaster: Freeing Skrach Uglogwee|~ 1"
      ],
      "beforePresent": true,
      "before": {
        "BaseQuest": "Recipe for Disaster: Freeing Skrach Uglogwee",
        "Description": "Inspect Skrach",
        "Chunks": [
          "12850-1"
        ],
        "Tasks": {
          "~|Recipe for Disaster: Another Cook's Quest|~ Complete the subquest": "Quest",
          "~|Big Chompy Bird Hunting|~ Complete the quest": "Quest"
        },
        "Skills": {
          "Cooking": 41,
          "Firemaking": 20
        },
        "Not F2P": true,
        "NoBoost": true
      },
      "beforeRecordSha256": "35782b21e74076c5fbc0017043635e462acaf9a3966b89fa7ae9e8e787d49218",
      "afterPresent": true,
      "after": {
        "BaseQuest": "Recipe for Disaster: Freeing Skrach Uglogwee",
        "Description": "Inspect Skrach",
        "Chunks": [
          "12850-1"
        ],
        "Tasks": {
          "~|Recipe for Disaster: Another Cook's Quest|~ Complete the subquest": "Quest",
          "~|Big Chompy Bird Hunting|~ Complete the quest": "Quest"
        },
        "Skills": {
          "Cooking": 41,
          "Firemaking": 20
        },
        "Not F2P": true
      },
      "findings": [
        "H10",
        "H11"
      ],
      "evidence": {
        "title": "Recipe for Disaster: Freeing Skrach Uglogwee",
        "revision": 37224649,
        "url": "https://runescape.wiki/w/Special:PermanentLink/37224649"
      },
      "reason": "Allow boosting only the named skills; preserve every other skill gate."
    },
    {
      "path": [
        "challenges",
        "Quest",
        "~|Regicide|~ 1"
      ],
      "beforePresent": true,
      "before": {
        "BaseQuest": "Regicide",
        "Description": "Talk to King Lathas",
        "Chunks": [
          "10291"
        ],
        "Tasks": {
          "~|Underground Pass|~ Complete the quest": "Quest"
        },
        "Skills": {
          "Agility": 56
        },
        "Not F2P": true,
        "NoBoost": true
      },
      "beforeRecordSha256": "077f482bda41e91c40510d5e0d1d0ab4d50a5ccbfb285cd0f36dd9d2733135a7",
      "afterPresent": true,
      "after": {
        "BaseQuest": "Regicide",
        "Description": "Talk to King Lathas",
        "Chunks": [
          "10291"
        ],
        "Tasks": {
          "~|Underground Pass|~ Complete the quest": "Quest"
        },
        "Skills": {
          "Agility": 56
        },
        "Not F2P": true
      },
      "findings": [
        "H12"
      ],
      "evidence": {
        "title": "Regicide",
        "revision": 37219005,
        "url": "https://runescape.wiki/w/Special:PermanentLink/37219005"
      },
      "reason": "Allow boosting only the named skills; preserve every other skill gate."
    },
    {
      "path": [
        "challenges",
        "Nonskill",
        "Shades of Mort'ton: boostable Firemaking gate"
      ],
      "beforePresent": false,
      "afterPresent": true,
      "after": {
        "PickerId": "rs3:task:qfix1-shades-of-mort-ton-boostable-firemaking-gate",
        "BaseQuest": "Shades of Mort'ton",
        "Skills": {
          "Firemaking": 6
        }
      },
      "findings": [
        "H13"
      ],
      "evidence": {
        "title": "Shades of Mort'ton",
        "revision": 37182655,
        "url": "https://runescape.wiki/w/Special:PermanentLink/37182655"
      },
      "reason": "Separate the named boostable skill from the unchanged unboostable skills."
    },
    {
      "path": [
        "challenges",
        "Quest",
        "~|Shades of Mort'ton|~ 1"
      ],
      "beforePresent": true,
      "before": {
        "BaseQuest": "Shades of Mort'ton",
        "Description": "Read the diary of Herbi Flax",
        "Chunks": [
          "13875-1"
        ],
        "Skills": {
          "Crafting": 20,
          "Firemaking": 6,
          "Herblore": 15
        },
        "Not F2P": true,
        "NoBoost": true
      },
      "beforeRecordSha256": "e575122cc60e5d8e13e207897dff34d3cb333d511362396740907bf81efddf7d",
      "afterPresent": true,
      "after": {
        "BaseQuest": "Shades of Mort'ton",
        "Description": "Read the diary of Herbi Flax",
        "Chunks": [
          "13875-1"
        ],
        "Skills": {
          "Crafting": 20,
          "Herblore": 15
        },
        "Not F2P": true,
        "NoBoost": true,
        "Tasks": {
          "Shades of Mort'ton: boostable Firemaking gate": "Nonskill"
        }
      },
      "findings": [
        "H13"
      ],
      "evidence": {
        "title": "Shades of Mort'ton",
        "revision": 37182655,
        "url": "https://runescape.wiki/w/Special:PermanentLink/37182655"
      },
      "reason": "Allow boosting only the named skills; preserve every other skill gate."
    },
    {
      "path": [
        "codeItems",
        "chunksPlus",
        "PrayerAltarChunks[+]"
      ],
      "beforePresent": true,
      "before": [
        "11828",
        "10290",
        "10806-1",
        "12854",
        "Underground Pass",
        "10035-1",
        "10291",
        "12850-1",
        "Sunken Tutorial Island",
        "11825-1",
        "11574",
        "11575-1",
        "13617-1",
        "12086",
        "11316",
        "Goblin Temple",
        "8757",
        "8755",
        "9265-1",
        "Jaldraocht Pyramid",
        "12331-1",
        "13622-1",
        "13098-1",
        "10803",
        "Nature Grotto",
        "War's Retreat",
        "Senntisten Temple",
        "God Wars Dungeon",
        "Kharid-et - Barracks excavation site",
        "14388-1",
        "12087-3",
        "11830-1",
        "12852",
        "12856",
        "11835",
        "Yanille Agility Dungeon",
        "9778-1",
        "9012-1",
        "11056",
        "11051-1",
        "Uzer Mastaba",
        "8508",
        "13613",
        "11829-1",
        "7995"
      ],
      "beforeRecordSha256": "e6c68c05a9c66e7b5e0cef0247fce4613ac352d4bde304149a2b3219c967475c",
      "afterPresent": true,
      "after": [
        "11828",
        "10290",
        "10806-1",
        "12854",
        "Underground Pass",
        "10035-1",
        "10291",
        "12850-1",
        "Sunken Tutorial Island",
        "11825-1",
        "11574",
        "11575-1",
        "13617-1",
        "12086",
        "11316",
        "Goblin Temple",
        "8757",
        "8755",
        "9265-1",
        "Jaldraocht Pyramid",
        "12331-1",
        "13622-1",
        "13098-1",
        "10803",
        "Nature grotto",
        "War's Retreat",
        "Senntisten Temple",
        "God Wars Dungeon",
        "Kharid-et - Barracks excavation site",
        "14388-1",
        "12087-3",
        "11830-1",
        "12852",
        "12856",
        "11835",
        "Yanille Agility Dungeon",
        "9778-1",
        "9012-1",
        "11056",
        "11051-1",
        "Uzer Mastaba",
        "8508",
        "13613",
        "11829-1",
        "7995"
      ],
      "findings": [
        "H14"
      ],
      "evidence": [
        {
          "title": "God Emissaries/Tasks",
          "revision": 37152824,
          "url": "https://runescape.wiki/w/Special:PermanentLink/37152824"
        },
        {
          "title": "Nature Grotto",
          "revision": 37124527,
          "url": "https://runescape.wiki/w/Special:PermanentLink/37124527"
        }
      ],
      "reason": "Correct the exact alias join to an existing declared source; retain choice order and count."
    },
    {
      "path": [
        "codeItems",
        "itemsPlus",
        "Zarosian Artefact[+]"
      ],
      "beforePresent": true,
      "before": [
        "Venator light crossbow",
        "Venator dagger",
        "Primis Elementis standard",
        "Legionary square shield",
        "Legionary gladius",
        "Zarosian training dummy",
        "Zaros effigy",
        "Legatus Maximus figurine",
        "'Solem in Umbra' painting",
        "Legatus pendant",
        "Ancient timepiece",
        "Pontifex signet ring",
        "'Incite Fear' spell scroll",
        "Funerary urn of shadow",
        "Curse tablet",
        "Apex cap",
        "Infula robes",
        "Hand of the Ancients",
        "Funerary urn of smoke",
        "Loarnab rod",
        "Funerary urn of ice",
        "Decorative amphora",
        "Inquisitor's seal",
        "Inquisitor's ceremonial mask",
        "Inquisitor's ceremonial armour",
        "Gladiator sword",
        "Gladiator helmet",
        "Funerary urn of blood",
        "Model chariot",
        "Funerary urn of miasma",
        "'The Serpent's Fall' carving",
        "Pontifex Maximus figurine",
        "Cermonial mace",
        "'Consensus ad Idem' painting",
        "Pontifex mitre",
        "Pontifex crozier",
        "Pontifex censer",
        "Necromantic focus",
        "'Exsanguinate' spell scroll",
        "Zarosian stein",
        "Zarosian ewer",
        "Vigorem vial",
        "'Smoke Cloud' spell scroll",
        "Portable phylactery",
        "Ancient magic tablet",
        "'Animate Dead' spell scroll",
        "Praetorian staff",
        "Praetorian robes",
        "Praetorian hood",
        "Battle plans",
        "Ancient globe",
        "'Prima Legio' painting"
      ],
      "beforeRecordSha256": "a734d590c8b92e1e256be10dcb8fa48f87d446c607ed21f11a39eada2ca3949b",
      "afterPresent": true,
      "after": [
        "Venator light crossbow",
        "Venator dagger",
        "Primis Elementis standard",
        "Legionary square shield",
        "Legionary gladius",
        "Zarosian training dummy",
        "Zaros effigy",
        "Legatus Maximus figurine",
        "'Solem in Umbra' painting",
        "Legatus pendant",
        "Ancient timepiece",
        "Pontifex signet ring",
        "'Incite Fear' spell scroll",
        "Funerary urn of shadow",
        "Curse tablet",
        "Apex cap",
        "Infula robes",
        "Hand of the Ancients",
        "Funerary urn of smoke",
        "Loarnab rod",
        "Funerary urn of ice",
        "Decorative amphora",
        "Inquisitor's seal",
        "Inquisitor's ceremonial mask",
        "Inquisitor's ceremonial armour",
        "Gladiator sword",
        "Gladiator helmet",
        "Funerary urn of blood",
        "Model chariot",
        "Funerary urn of miasma",
        "'The Serpent's Fall' carving",
        "Pontifex Maximus figurine",
        "Ceremonial mace",
        "'Consensus ad Idem' painting",
        "Pontifex mitre",
        "Pontifex crozier",
        "Pontifex censer",
        "Necromantic focus",
        "'Exsanguinate' spell scroll",
        "Zarosian stein",
        "Zarosian ewer",
        "Vigorem vial",
        "'Smoke Cloud' spell scroll",
        "Portable phylactery",
        "Ancient magic tablet",
        "'Animate Dead' spell scroll",
        "Praetorian staff",
        "Praetorian robes",
        "Praetorian hood",
        "Battle plans",
        "Ancient globe",
        "'Prima Legio' painting"
      ],
      "findings": [
        "H15"
      ],
      "evidence": [
        {
          "title": "Beneath Scabaras' Sands",
          "revision": 37173764,
          "url": "https://runescape.wiki/w/Special:PermanentLink/37173764"
        },
        {
          "title": "Ceremonial mace",
          "revision": 36976826,
          "url": "https://runescape.wiki/w/Special:PermanentLink/36976826"
        }
      ],
      "reason": "Correct the exact alias join to an existing declared source; retain choice order and count."
    },
    {
      "path": [
        "codeItems",
        "itemsPlus",
        "Granite[+]"
      ],
      "beforePresent": true,
      "before": [
        "Grantie (5kg)",
        "Granite (2kg)",
        "Granite (500g)"
      ],
      "beforeRecordSha256": "e9acb1dc48965e716668007d709a6800392f4745a626466ba64f65efc6a62b93",
      "afterPresent": true,
      "after": [
        "Granite (5kg)",
        "Granite (2kg)",
        "Granite (500g)"
      ],
      "findings": [
        "H16"
      ],
      "evidence": [
        {
          "title": "King's Ransom",
          "revision": 37224097,
          "url": "https://runescape.wiki/w/Special:PermanentLink/37224097"
        },
        {
          "title": "Granite (5kg)",
          "revision": 37179516,
          "url": "https://runescape.wiki/w/Special:PermanentLink/37179516"
        }
      ],
      "reason": "Correct the exact alias join to an existing declared source; retain choice order and count."
    },
    {
      "path": [
        "codeItems",
        "itemsPlus",
        "BigChompy8[+]"
      ],
      "beforePresent": true,
      "before": [
        "Onion",
        "Doogle leaves",
        "Equa leaves",
        "Tomato",
        "Potato",
        "Cabbage"
      ],
      "beforeRecordSha256": "1ae7765361c2545b16102474910dc54f6c92a8f67210780cbae8388ddde090d9",
      "afterPresent": true,
      "after": [
        "Onion",
        "Doogle leaves",
        "Equa leaves",
        "Tomato",
        "Raw potato",
        "Cabbage"
      ],
      "findings": [
        "H18"
      ],
      "evidence": {
        "title": "Big Chompy Bird Hunting",
        "revision": 37182718,
        "url": "https://runescape.wiki/w/Special:PermanentLink/37182718"
      },
      "reason": "Correct the exact alias join to an existing declared source; retain choice order and count."
    },
    {
      "path": [
        "challenges",
        "Quest",
        "~|King's Ransom|~ 6"
      ],
      "beforePresent": true,
      "before": {
        "BaseQuest": "King's Ransom",
        "Description": "Free King Arthur",
        "Chunks": [
          "12087-3"
        ],
        "Items": [
          "Granite[+]",
          "Bronze med helm",
          "Iron chainbody",
          "Black full helm"
        ],
        "Tasks": {
          "~|King's Ransom|~ 5": "Quest"
        },
        "Skills": {
          "Magic": 45
        },
        "Not F2P": true,
        "NoBoost": true
      },
      "beforeRecordSha256": "d9a35bacbc700343358268aade2bbbfc1780bdc0c6cf0092692f1556482073be",
      "afterPresent": true,
      "after": {
        "BaseQuest": "King's Ransom",
        "Description": "Free King Arthur",
        "Chunks": [
          "12087-3"
        ],
        "Items": [
          "Granite[+]",
          "Bronze med helm",
          "Iron chainbody"
        ],
        "Tasks": {
          "~|King's Ransom|~ 5": "Quest"
        },
        "Skills": {
          "Magic": 45
        },
        "Not F2P": true,
        "NoBoost": true
      },
      "findings": [
        "H17"
      ],
      "evidence": {
        "title": "King's Ransom",
        "revision": 37224097,
        "url": "https://runescape.wiki/w/Special:PermanentLink/37224097"
      },
      "reason": "The supplied non-equippable quest helm is distinct from an ordinary black full helm; retain bronze med helm and iron chainbody."
    }
  ]
};
