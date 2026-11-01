// Reviewed reference repairs applied through applyDefinitionOverlays. Archived export bytes and existing task IDs stay unchanged.
export default {
  "schemaVersion": 1,
  "id": "reference-corrections",
  "version": "2026-11-01.v2",
  "reviewedOn": "2026-11-01",
  "provenance": {
    "referenceSha256": "9dd835266f381abaa4d14033abcd0b43a001fe96d7df0a7f046fcc8676d66553",
    "method": "Exact reference-audit inventory and existing exported sources/outputs; no fuzzy runtime admission.",
    "championScrolls": {
      "url": "https://runescape.wiki/w/Champion%27s_Challenge",
      "source": "The Goblin scroll is an existing Goblin drop; restore the missing distinct child while deduplicating Zombie."
    },
    "ardougneHard": {
      "evidence": "Wiki revisions supplied and verified by the task owner; no fresh retrieval in this sandbox.",
      "tier": {
        "title": "Ardougne Achievements",
        "revisionId": 36199598,
        "url": "https://runescape.wiki/w/Special:PermanentLink/36199598",
        "finding": "Hard has 17 required achievements. Artillery Strike is task 17; no optional tasks, exemptions or tier footnotes. Cloak rewards also require previous tiers."
      },
      "constituent": {
        "title": "Artillery Strike",
        "revisionId": 37053862,
        "url": "https://runescape.wiki/w/Special:PermanentLink/37053862",
        "achievementId": 502,
        "finding": "Hard Ardougne achievements; requires Catapult Construction; members-only."
      }
    }
  },
  "patches": [
    {
      "path": [
        "challenges",
        "Agility",
        "Use an ~|experience lamp|~ from the Waiko Reward Shop on Agility",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Ports XP Lamp"
      ],
      "beforeRecordSha256": "74a495b52d37cba62781ca089828f025d9cc66ac856a9aa5642885d4d64cf7df",
      "afterPresent": true,
      "after": [
        "Ports XP lamp"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Ports XP Lamp",
          "to": "Ports XP lamp"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Agility",
        "Make a ~|Milestone cape (90)|~",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Balls of wool"
      ],
      "beforeRecordSha256": "b15806d75ac540937a0d66fc3735735c15200125abdd02e5bf8be93526f50631",
      "afterPresent": true,
      "after": [
        "Ball of wool"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Balls of wool",
          "to": "Ball of wool"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Archaeology",
        "Make a ~|Milestone cape (90)|~",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Balls of wool"
      ],
      "beforeRecordSha256": "b15806d75ac540937a0d66fc3735735c15200125abdd02e5bf8be93526f50631",
      "afterPresent": true,
      "after": [
        "Ball of wool"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Balls of wool",
          "to": "Ball of wool"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Attack",
        "Make a ~|Milestone cape (90)|~",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Balls of wool"
      ],
      "beforeRecordSha256": "b15806d75ac540937a0d66fc3735735c15200125abdd02e5bf8be93526f50631",
      "afterPresent": true,
      "after": [
        "Ball of wool"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Balls of wool",
          "to": "Ball of wool"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Constitution",
        "Make a ~|Milestone cape (90)|~",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Balls of wool"
      ],
      "beforeRecordSha256": "b15806d75ac540937a0d66fc3735735c15200125abdd02e5bf8be93526f50631",
      "afterPresent": true,
      "after": [
        "Ball of wool"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Balls of wool",
          "to": "Ball of wool"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Construction",
        "Use an ~|experience lamp|~ from the Waiko Reward Shop on Construction",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Ports XP Lamp"
      ],
      "beforeRecordSha256": "74a495b52d37cba62781ca089828f025d9cc66ac856a9aa5642885d4d64cf7df",
      "afterPresent": true,
      "after": [
        "Ports XP lamp"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Ports XP Lamp",
          "to": "Ports XP lamp"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Construction",
        "Construct ~|blue candles (4 candles 1)|~",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "White candles*"
      ],
      "beforeRecordSha256": "c7709b8b97c036f792a68a21dac9390f6622c850c0856a7e505bd46f152a77ba",
      "afterPresent": true,
      "after": [
        "White candle*"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "White candles",
          "to": "White candle"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Construction",
        "Construct a ~|King Arthur portrait|~",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Teak plank*",
        "Arthur portait*"
      ],
      "beforeRecordSha256": "63fb2c90d2190f31c2c8440845b40fb8d8e1ba7307d39e8701a50a671d99f93a",
      "afterPresent": true,
      "after": [
        "Teak plank*",
        "Arthur portrait*"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Arthur portait",
          "to": "Arthur portrait"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Construction",
        "Construct a ~|King Alvis painting|~",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Teak plank*",
        "Keldargim portrait*"
      ],
      "beforeRecordSha256": "043d207957f6d888109e569e71cc3f261f6745f81b41a4fff505b34b705de19b",
      "afterPresent": true,
      "after": [
        "Teak plank*",
        "Keldagrim portrait*"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Keldargim portrait",
          "to": "Keldagrim portrait"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Construction",
        "Construct an ~|oak long table|~",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Oak planl"
      ],
      "beforeRecordSha256": "8bd82b0011d7ed03097ddad908e5b6ffbd5b30dab50a6c89e6f213a9d4252a5e",
      "afterPresent": true,
      "after": [
        "Oak plank"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Oak planl",
          "to": "Oak plank"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Construction",
        "Construct a ~|Lumbridge painting (player-owned house)|~",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Teak plank*",
        "Lumbirdge painting*"
      ],
      "beforeRecordSha256": "91204c6f68f350dd973906516a470a2e1d9498e95b99d87767b43abe69099767",
      "afterPresent": true,
      "after": [
        "Teak plank*",
        "Lumbridge painting*"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Lumbirdge painting",
          "to": "Lumbridge painting"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Construction",
        "Construct ~|oak shelves 3|~",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Oak planks*",
        "Soft clay*"
      ],
      "beforeRecordSha256": "9cb79738427635e3b7e68a53198915601cc2757058977d05af3663decefe39e2",
      "afterPresent": true,
      "after": [
        "Oak plank*",
        "Soft clay*"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Oak planks",
          "to": "Oak plank"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Construction",
        "Construct a ~|mahogany gilded bed|~",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Mahogany plank*",
        "Bolt of cloth*",
        "Golf leaf*"
      ],
      "beforeRecordSha256": "5290e3bf1654e42de0c7700adc8ad546157e538073a320254feec9c99006ec2e",
      "afterPresent": true,
      "after": [
        "Mahogany plank*",
        "Bolt of cloth*",
        "Gold leaf*"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Golf leaf",
          "to": "Gold leaf"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Construction",
        "Construct a ~|mahogany gilded chair|~",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Mahogany plank*",
        "Golf leaf*"
      ],
      "beforeRecordSha256": "a462299e6b574396edcc37ca3fd7c35e8b640b53a84bf9df9ca53e1d9b2523d1",
      "afterPresent": true,
      "after": [
        "Mahogany plank*",
        "Gold leaf*"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Golf leaf",
          "to": "Gold leaf"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Construction",
        "Construct a ~|small gold pile|~",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Small stone pedestal*",
        "Marble block*",
        "Golf leaf*",
        "Furniture plans: Small gold pile"
      ],
      "beforeRecordSha256": "515fc3a71365b30bbb161c6261646c5c404074c2a409b8d8dadd19cc50f56000",
      "afterPresent": true,
      "after": [
        "Small stone pedestal*",
        "Marble block*",
        "Gold leaf*",
        "Furniture plans: Small gold pile"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Golf leaf",
          "to": "Gold leaf"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Construction",
        "Construct a ~|medium gold pile|~",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Small stone pedestal*",
        "Marble block*",
        "Golf leaf*",
        "Furniture plans: Medium gold pile"
      ],
      "beforeRecordSha256": "ae0dbfc1774a80c8036237517330b4f5bbf6ddd348b8763be4b866bdc96ae39f",
      "afterPresent": true,
      "after": [
        "Small stone pedestal*",
        "Marble block*",
        "Gold leaf*",
        "Furniture plans: Medium gold pile"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Golf leaf",
          "to": "Gold leaf"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Construction",
        "Construct a ~|ceramic oakleaf pot|~",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Soft clay*",
        "Bagged desert oakleaf flower*"
      ],
      "beforeRecordSha256": "4d070f183013b982f7933aaac34c8e74e6c8ee82b35c2d078ae9ae668b3ad2f0",
      "afterPresent": true,
      "after": [
        "Soft clay*",
        "Bagged desert oakleaf flowers*"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Bagged desert oakleaf flower",
          "to": "Bagged desert oakleaf flowers"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Construction",
        "Construct a ~|fancy jewellery box|~",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Basic jewelry box*",
        "Mahogany plank*",
        "Gold leaf*",
        "Combat bracelet*",
        "Enlightened amulet*",
        "Skills necklace*"
      ],
      "beforeRecordSha256": "35b2917cf21e6cf7cc76b0099cb874e79f9058d4e0bebd03c859e6a87cd373cb",
      "afterPresent": true,
      "after": [
        "Basic jewellery box*",
        "Mahogany plank*",
        "Gold leaf*",
        "Combat bracelet*",
        "Enlightened amulet*",
        "Skills necklace*"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Basic jewelry box",
          "to": "Basic jewellery box"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Construction",
        "Make a ~|Milestone cape (90)|~",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Balls of wool"
      ],
      "beforeRecordSha256": "b15806d75ac540937a0d66fc3735735c15200125abdd02e5bf8be93526f50631",
      "afterPresent": true,
      "after": [
        "Ball of wool"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Balls of wool",
          "to": "Ball of wool"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Construction",
        "Construct an ~|ornate jewellery box|~",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Fancy jewellery box*",
        "Mahogany plank*",
        "Gold leaf*",
        "Amulet of glory*",
        "Ring of slaying*",
        "Ring of Wealth*"
      ],
      "beforeRecordSha256": "95018a659244c671f1a8c721a049d51d3c1190a8f64c0c0670d8f96824f40f97",
      "afterPresent": true,
      "after": [
        "Fancy jewellery box*",
        "Mahogany plank*",
        "Gold leaf*",
        "Amulet of glory*",
        "Ring of Slaying*",
        "Ring of Wealth*"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Ring of slaying",
          "to": "Ring of Slaying"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Cooking",
        "Use an ~|experience lamp|~ from the Waiko Reward Shop on Cooking",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Ports XP Lamp"
      ],
      "beforeRecordSha256": "74a495b52d37cba62781ca089828f025d9cc66ac856a9aa5642885d4d64cf7df",
      "afterPresent": true,
      "after": [
        "Ports XP lamp"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Ports XP Lamp",
          "to": "Ports XP lamp"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Cooking",
        "Make a ~|Milestone cape (90)|~",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Balls of wool"
      ],
      "beforeRecordSha256": "b15806d75ac540937a0d66fc3735735c15200125abdd02e5bf8be93526f50631",
      "afterPresent": true,
      "after": [
        "Ball of wool"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Balls of wool",
          "to": "Ball of wool"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Crafting",
        "Make a ~|Milestone cape (90)|~",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Balls of wool"
      ],
      "beforeRecordSha256": "b15806d75ac540937a0d66fc3735735c15200125abdd02e5bf8be93526f50631",
      "afterPresent": true,
      "after": [
        "Ball of wool"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Balls of wool",
          "to": "Ball of wool"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Crafting",
        "Craft ~|elite dracolich boots|~",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Dracolich boots*",
        "Ancient scale*",
        "Algarum thread*",
        "Preasulic essence (ranged)*"
      ],
      "beforeRecordSha256": "65b8248a8a7e29ee24aad73c2778156c56eafdfe72c763f315cadbf90eb4e9e5",
      "afterPresent": true,
      "after": [
        "Dracolich boots*",
        "Ancient scale*",
        "Algarum thread*",
        "Praesulic essence (ranged)*"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Preasulic essence (ranged)",
          "to": "Praesulic essence (ranged)"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Crafting",
        "Craft ~|elite dracolich chaps|~",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Dracolich chaps*",
        "Ancient scale*",
        "Algarum thread*",
        "Preasulic essence (ranged)*"
      ],
      "beforeRecordSha256": "07d1811aa05277833ff097e7f43517123f0ec37b5887add33f905d846ea68afc",
      "afterPresent": true,
      "after": [
        "Dracolich chaps*",
        "Ancient scale*",
        "Algarum thread*",
        "Praesulic essence (ranged)*"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Preasulic essence (ranged)",
          "to": "Praesulic essence (ranged)"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Crafting",
        "Craft an ~|elite dracolich coif|~",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Dracolich coif*",
        "Ancient scale*",
        "Algarum thread*",
        "Preasulic essence (ranged)*"
      ],
      "beforeRecordSha256": "cc7c933ca4075e47efa5845e580ba712e89d22c0a9f8aa84648a57b010b21ea7",
      "afterPresent": true,
      "after": [
        "Dracolich coif*",
        "Ancient scale*",
        "Algarum thread*",
        "Praesulic essence (ranged)*"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Preasulic essence (ranged)",
          "to": "Praesulic essence (ranged)"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Crafting",
        "Craft an ~|elite dracolich hauberk|~",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Dracolich hauberk*",
        "Ancient scale*",
        "Algarum thread*",
        "Preasulic essence (ranged)*"
      ],
      "beforeRecordSha256": "57f8cbf89efc9ccf7f1636f629ac4529150cb3dd0b4cfb90acec1fbcb4a520d4",
      "afterPresent": true,
      "after": [
        "Dracolich hauberk*",
        "Ancient scale*",
        "Algarum thread*",
        "Praesulic essence (ranged)*"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Preasulic essence (ranged)",
          "to": "Praesulic essence (ranged)"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Crafting",
        "Craft ~|elite dracolich vambraces|~",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Dracolich vambraces*",
        "Ancient scale*",
        "Algarum thread*",
        "Preasulic essence (ranged)*"
      ],
      "beforeRecordSha256": "6e1ec74db6a93297b0b9a3b85cdc395db3c5fda591dac0a7743d4f0f85a8a5de",
      "afterPresent": true,
      "after": [
        "Dracolich vambraces*",
        "Ancient scale*",
        "Algarum thread*",
        "Praesulic essence (ranged)*"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Preasulic essence (ranged)",
          "to": "Praesulic essence (ranged)"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Crafting",
        "Craft an ~|artificer's measure|~",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Pasaha*",
        "Dragon scalpel*",
        "Orthenglass flask*",
        "Protective goggles*",
        "Magiic stone*",
        "Gem bag (upgraded)*",
        "Mystic cloth*",
        "Blessed molten glass*",
        "Glorious silvthril chain*",
        "Onyx*"
      ],
      "beforeRecordSha256": "a35b625b7dac5248ef745ab1283e8dc2085acc5c554d9c7560b3b541069d8d83",
      "afterPresent": true,
      "after": [
        "Pasaha*",
        "Dragon scalpel*",
        "Orthenglass flask*",
        "Protective goggles*",
        "Magic stone*",
        "Gem bag (upgraded)*",
        "Mystic cloth*",
        "Blessed molten glass*",
        "Glorious silvthril chain*",
        "Onyx*"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Magiic stone",
          "to": "Magic stone"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Defence",
        "Wield ~|Sir Owen Sonde's shield|~",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Sire Owen Sonde's shield"
      ],
      "beforeRecordSha256": "15401e850981c29b3e57364a1ccd442e9872bc921cf45cf3ad999d02dc30953c",
      "afterPresent": true,
      "after": [
        "Sir Owen Sonde's shield"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Sire Owen Sonde's shield",
          "to": "Sir Owen Sonde's shield"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Defence",
        "Wield a ~|mirror shield|~",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Mirror sield"
      ],
      "beforeRecordSha256": "086bf5858cbabd4171c2df47e106c9263d911c9ff7f5a8d8581cf68b2abdf846",
      "afterPresent": true,
      "after": [
        "Mirror shield"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Mirror sield",
          "to": "Mirror shield"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Defence",
        "Make a ~|Milestone cape (90)|~",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Balls of wool"
      ],
      "beforeRecordSha256": "b15806d75ac540937a0d66fc3735735c15200125abdd02e5bf8be93526f50631",
      "afterPresent": true,
      "after": [
        "Ball of wool"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Balls of wool",
          "to": "Ball of wool"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Divination",
        "Use an ~|experience lamp|~ from the Waiko Reward Shop on Divination",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Ports XP Lamp"
      ],
      "beforeRecordSha256": "74a495b52d37cba62781ca089828f025d9cc66ac856a9aa5642885d4d64cf7df",
      "afterPresent": true,
      "after": [
        "Ports XP lamp"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Ports XP Lamp",
          "to": "Ports XP lamp"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Divination",
        "Make a ~|Milestone cape (90)|~",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Balls of wool"
      ],
      "beforeRecordSha256": "b15806d75ac540937a0d66fc3735735c15200125abdd02e5bf8be93526f50631",
      "afterPresent": true,
      "after": [
        "Ball of wool"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Balls of wool",
          "to": "Ball of wool"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Dungeoneering",
        "Use an ~|experience lamp|~ from the Waiko Reward Shop on Dungeoneering",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Ports XP Lamp"
      ],
      "beforeRecordSha256": "74a495b52d37cba62781ca089828f025d9cc66ac856a9aa5642885d4d64cf7df",
      "afterPresent": true,
      "after": [
        "Ports XP lamp"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Ports XP Lamp",
          "to": "Ports XP lamp"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Dungeoneering",
        "Make a ~|Milestone cape (90)|~",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Balls of wool"
      ],
      "beforeRecordSha256": "b15806d75ac540937a0d66fc3735735c15200125abdd02e5bf8be93526f50631",
      "afterPresent": true,
      "after": [
        "Ball of wool"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Balls of wool",
          "to": "Ball of wool"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Farming",
        "Make a ~|Milestone cape (90)|~",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Balls of wool"
      ],
      "beforeRecordSha256": "b15806d75ac540937a0d66fc3735735c15200125abdd02e5bf8be93526f50631",
      "afterPresent": true,
      "after": [
        "Ball of wool"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Balls of wool",
          "to": "Ball of wool"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Firemaking",
        "Light a ~|candle latern (white)|~",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Candle latern (white)"
      ],
      "beforeRecordSha256": "7e59afb758dfa13f428c99348d0b4a30b69d10ccebdef72bc3bf8a74ba202499",
      "afterPresent": true,
      "after": [
        "Candle lantern (white)"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Candle latern (white)",
          "to": "Candle lantern (white)"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Firemaking",
        "Light a ~|candle latern (black)|~",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Candle latern (black)"
      ],
      "beforeRecordSha256": "6a5e2aabfb1826aff07160df29d6ad6217d6d3eb873170b2e0c31e9e5847e25e",
      "afterPresent": true,
      "after": [
        "Candle lantern (black)"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Candle latern (black)",
          "to": "Candle lantern (black)"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Firemaking",
        "Make a ~|Milestone cape (90)|~",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Balls of wool"
      ],
      "beforeRecordSha256": "b15806d75ac540937a0d66fc3735735c15200125abdd02e5bf8be93526f50631",
      "afterPresent": true,
      "after": [
        "Ball of wool"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Balls of wool",
          "to": "Ball of wool"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Fishing",
        "Use an ~|experience lamp|~ from the Waiko Reward Shop on Fishing",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Ports XP Lamp"
      ],
      "beforeRecordSha256": "74a495b52d37cba62781ca089828f025d9cc66ac856a9aa5642885d4d64cf7df",
      "afterPresent": true,
      "after": [
        "Ports XP lamp"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Ports XP Lamp",
          "to": "Ports XP lamp"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Fishing",
        "Make a ~|Milestone cape (90)|~",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Balls of wool"
      ],
      "beforeRecordSha256": "b15806d75ac540937a0d66fc3735735c15200125abdd02e5bf8be93526f50631",
      "afterPresent": true,
      "after": [
        "Ball of wool"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Balls of wool",
          "to": "Ball of wool"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Fletching",
        "String an ~|off-hand rune crossbow|~",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Runite crossbow (unstrung)*",
        "Crossbow string*"
      ],
      "beforeRecordSha256": "4ab11c804adc8b92c90cefb76dd6b501c74d0686b6487b86cecf6137807b48e6",
      "afterPresent": true,
      "after": [
        "Rune crossbow (unstrung)*",
        "Crossbow string*"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Runite crossbow (unstrung)",
          "to": "Rune crossbow (unstrung)"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Fletching",
        "Make a ~|Milestone cape (90)|~",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Balls of wool"
      ],
      "beforeRecordSha256": "b15806d75ac540937a0d66fc3735735c15200125abdd02e5bf8be93526f50631",
      "afterPresent": true,
      "after": [
        "Ball of wool"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Balls of wool",
          "to": "Ball of wool"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Herblore",
        "Use an ~|experience lamp|~ from the Waiko Reward Shop on Herblore",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Ports XP Lamp"
      ],
      "beforeRecordSha256": "74a495b52d37cba62781ca089828f025d9cc66ac856a9aa5642885d4d64cf7df",
      "afterPresent": true,
      "after": [
        "Ports XP lamp"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Ports XP Lamp",
          "to": "Ports XP lamp"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Herblore",
        "Make a ~|Milestone cape (90)|~",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Balls of wool"
      ],
      "beforeRecordSha256": "b15806d75ac540937a0d66fc3735735c15200125abdd02e5bf8be93526f50631",
      "afterPresent": true,
      "after": [
        "Ball of wool"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Balls of wool",
          "to": "Ball of wool"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Hunter",
        "Use an ~|experience lamp|~ from the Waiko Reward Shop on Hunter",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Ports XP Lamp"
      ],
      "beforeRecordSha256": "74a495b52d37cba62781ca089828f025d9cc66ac856a9aa5642885d4d64cf7df",
      "afterPresent": true,
      "after": [
        "Ports XP lamp"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Ports XP Lamp",
          "to": "Ports XP lamp"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Hunter",
        "Make a ~|Milestone cape (90)|~",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Balls of wool"
      ],
      "beforeRecordSha256": "b15806d75ac540937a0d66fc3735735c15200125abdd02e5bf8be93526f50631",
      "afterPresent": true,
      "after": [
        "Ball of wool"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Balls of wool",
          "to": "Ball of wool"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Mining",
        "Make a ~|Milestone cape (90)|~",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Balls of wool"
      ],
      "beforeRecordSha256": "b15806d75ac540937a0d66fc3735735c15200125abdd02e5bf8be93526f50631",
      "afterPresent": true,
      "after": [
        "Ball of wool"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Balls of wool",
          "to": "Ball of wool"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Magic",
        "Equip a ~|corrupted slayer helmet|~",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Corrupter slayer helmet"
      ],
      "beforeRecordSha256": "3d0d45eb7ec189518b27baa6e8f403c7f3ef7c7017caea5e8f8e0d99f09dd24e",
      "afterPresent": true,
      "after": [
        "Corrupted slayer helmet"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Corrupter slayer helmet",
          "to": "Corrupted slayer helmet"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Magic",
        "Cast ~|slayer dart|~ with a slayer's staff",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Slayer's Staff",
        "Air rune[+]*",
        "Death rune*"
      ],
      "beforeRecordSha256": "6d2cb4c232cacb0e8a46c5db02cd2067530b46f37a86d36afd0f9f645798aa30",
      "afterPresent": true,
      "after": [
        "Slayer's staff",
        "Air rune[+]*",
        "Death rune*"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Slayer's Staff",
          "to": "Slayer's staff"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Magic",
        "Make a ~|Milestone cape (90)|~",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Balls of wool"
      ],
      "beforeRecordSha256": "b15806d75ac540937a0d66fc3735735c15200125abdd02e5bf8be93526f50631",
      "afterPresent": true,
      "after": [
        "Ball of wool"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Balls of wool",
          "to": "Ball of wool"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Necromancy",
        "Make a ~|Milestone cape (90)|~",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Balls of wool"
      ],
      "beforeRecordSha256": "b15806d75ac540937a0d66fc3735735c15200125abdd02e5bf8be93526f50631",
      "afterPresent": true,
      "after": [
        "Ball of wool"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Balls of wool",
          "to": "Ball of wool"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Prayer",
        "Use an ~|experience lamp|~ from the Waiko Reward Shop on Prayer",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Ports XP Lamp"
      ],
      "beforeRecordSha256": "74a495b52d37cba62781ca089828f025d9cc66ac856a9aa5642885d4d64cf7df",
      "afterPresent": true,
      "after": [
        "Ports XP lamp"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Ports XP Lamp",
          "to": "Ports XP lamp"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Prayer",
        "Make a ~|Milestone cape (90)|~",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Balls of wool"
      ],
      "beforeRecordSha256": "b15806d75ac540937a0d66fc3735735c15200125abdd02e5bf8be93526f50631",
      "afterPresent": true,
      "after": [
        "Ball of wool"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Balls of wool",
          "to": "Ball of wool"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Ranged",
        "Equip a ~|corrupted slayer helmet|~",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Corrupter slayer helmet"
      ],
      "beforeRecordSha256": "3d0d45eb7ec189518b27baa6e8f403c7f3ef7c7017caea5e8f8e0d99f09dd24e",
      "afterPresent": true,
      "after": [
        "Corrupted slayer helmet"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Corrupter slayer helmet",
          "to": "Corrupted slayer helmet"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Ranged",
        "Wield an ~|off-hand mithril dart|~",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Off-hand Mithril dart"
      ],
      "beforeRecordSha256": "7c1fe21d4e70d8cc945fe0a189839c70738995b23324146f7a6586bb479b6e4c",
      "afterPresent": true,
      "after": [
        "Off-hand mithril dart"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Off-hand Mithril dart",
          "to": "Off-hand mithril dart"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Ranged",
        "Unlock and use the ~|Corruption Shot|~ ability",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Corruption Shot Ability Codex"
      ],
      "beforeRecordSha256": "e9ed12c738fda9cacd5d625b1e611a83342260150e3927b743f700905e3b78d7",
      "afterPresent": true,
      "after": [
        "Corruption Shot ability codex"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Corruption Shot Ability Codex",
          "to": "Corruption Shot ability codex"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Ranged",
        "Wield an ~|off-hand Armadyl crossbow|~",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Off-hand Armardyl crossbow"
      ],
      "beforeRecordSha256": "4915f2e6852328252e87ea2766b9d37292565d4da77dc00ed601b03b8197b15f",
      "afterPresent": true,
      "after": [
        "Off-hand Armadyl crossbow"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Off-hand Armardyl crossbow",
          "to": "Off-hand Armadyl crossbow"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Ranged",
        "Make a ~|Milestone cape (90)|~",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Balls of wool"
      ],
      "beforeRecordSha256": "b15806d75ac540937a0d66fc3735735c15200125abdd02e5bf8be93526f50631",
      "afterPresent": true,
      "after": [
        "Ball of wool"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Balls of wool",
          "to": "Ball of wool"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Ranged",
        "Wield an ~|off-hand blightbound crossbow|~",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Off-hand blightbound crossbow"
      ],
      "beforeRecordSha256": "3b7aa579d14a96f0a86e376f6316c04547e111dd5b035b7559598277503be7ce",
      "afterPresent": true,
      "after": [
        "Off-hand Blightbound crossbow"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Off-hand blightbound crossbow",
          "to": "Off-hand Blightbound crossbow"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Ranged",
        "Equip a ~|splintering arrow|~",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Splintering arrow"
      ],
      "beforeRecordSha256": "d2fd2a87fff73672bc41eb540acf38e139a003cde227f4bd46821b263a9fd85c",
      "afterPresent": true,
      "after": [
        "Splintering arrows"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Splintering arrow",
          "to": "Splintering arrows"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Runecrafting",
        "Use an ~|experience lamp|~ from the Waiko Reward Shop on Runecrafting",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Ports XP Lamp"
      ],
      "beforeRecordSha256": "74a495b52d37cba62781ca089828f025d9cc66ac856a9aa5642885d4d64cf7df",
      "afterPresent": true,
      "after": [
        "Ports XP lamp"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Ports XP Lamp",
          "to": "Ports XP lamp"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Runecrafting",
        "Make a ~|Milestone cape (90)|~",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Balls of wool"
      ],
      "beforeRecordSha256": "b15806d75ac540937a0d66fc3735735c15200125abdd02e5bf8be93526f50631",
      "afterPresent": true,
      "after": [
        "Ball of wool"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Balls of wool",
          "to": "Ball of wool"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Slayer",
        "Use an ~|experience lamp|~ from the Waiko Reward Shop on Slayer",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Ports XP Lamp"
      ],
      "beforeRecordSha256": "74a495b52d37cba62781ca089828f025d9cc66ac856a9aa5642885d4d64cf7df",
      "afterPresent": true,
      "after": [
        "Ports XP lamp"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Ports XP Lamp",
          "to": "Ports XP lamp"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Slayer",
        "Cast ~|slayer dart|~ with a slayer's staff",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Slayer's Staff",
        "Air rune[+]",
        "Death rune"
      ],
      "beforeRecordSha256": "b6a64a1260aa50e304437ab761862ff1bab6e710a845a99d4a53a2bf9b35320d",
      "afterPresent": true,
      "after": [
        "Slayer's staff",
        "Air rune[+]",
        "Death rune"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Slayer's Staff",
          "to": "Slayer's staff"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Slayer",
        "Make a ~|Milestone cape (90)|~",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Balls of wool"
      ],
      "beforeRecordSha256": "b15806d75ac540937a0d66fc3735735c15200125abdd02e5bf8be93526f50631",
      "afterPresent": true,
      "after": [
        "Ball of wool"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Balls of wool",
          "to": "Ball of wool"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Smithing",
        "Sing a piece of ~|attuned crystal armour|~",
        "Objects"
      ],
      "beforePresent": true,
      "before": [
        "Signing bowl (Ithell district)"
      ],
      "beforeRecordSha256": "2d6f683789b68c3a42e2bb135427d6f7cc5f4cc16bd6a8a34b3d3d547a053385",
      "afterPresent": true,
      "after": [
        "Singing bowl (Ithell district)"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Signing bowl (Ithell district)",
          "to": "Singing bowl (Ithell district)"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Smithing",
        "Sing a ~|attuned crystal weapon|~",
        "Objects"
      ],
      "beforePresent": true,
      "before": [
        "Signing bowl (Ithell district)"
      ],
      "beforeRecordSha256": "2d6f683789b68c3a42e2bb135427d6f7cc5f4cc16bd6a8a34b3d3d547a053385",
      "afterPresent": true,
      "after": [
        "Singing bowl (Ithell district)"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Signing bowl (Ithell district)",
          "to": "Singing bowl (Ithell district)"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Smithing",
        "Make a ~|Milestone cape (90)|~",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Balls of wool"
      ],
      "beforeRecordSha256": "b15806d75ac540937a0d66fc3735735c15200125abdd02e5bf8be93526f50631",
      "afterPresent": true,
      "after": [
        "Ball of wool"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Balls of wool",
          "to": "Ball of wool"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Strength",
        "Equip a ~|corrupted slayer helmet|~",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Corrupter slayer helmet"
      ],
      "beforeRecordSha256": "3d0d45eb7ec189518b27baa6e8f403c7f3ef7c7017caea5e8f8e0d99f09dd24e",
      "afterPresent": true,
      "after": [
        "Corrupted slayer helmet"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Corrupter slayer helmet",
          "to": "Corrupted slayer helmet"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Strength",
        "Make a ~|Milestone cape (90)|~",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Balls of wool"
      ],
      "beforeRecordSha256": "b15806d75ac540937a0d66fc3735735c15200125abdd02e5bf8be93526f50631",
      "afterPresent": true,
      "after": [
        "Ball of wool"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Balls of wool",
          "to": "Ball of wool"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Summoning",
        "Create a ~|ravenous locust scroll (Famine)|~",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Ravecous locust pouch*"
      ],
      "beforeRecordSha256": "ab9b73db7a03290311aa6ab944dbde3c7f6356a05e36e3a737465f81d2bfc1f9",
      "afterPresent": true,
      "after": [
        "Ravenous locust pouch*"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Ravecous locust pouch",
          "to": "Ravenous locust pouch"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Summoning",
        "Obtain a ~|zamorak hawk|~",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Bird's egg (red"
      ],
      "beforeRecordSha256": "4b9cfe9ad3f970a299a4ab30988a323eb072a53fc29fa5844fdde64583b38839",
      "afterPresent": true,
      "after": [
        "Bird's egg (red)"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Bird's egg (red",
          "to": "Bird's egg (red)"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Summoning",
        "Make a ~|Milestone cape (90)|~",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Balls of wool"
      ],
      "beforeRecordSha256": "b15806d75ac540937a0d66fc3735735c15200125abdd02e5bf8be93526f50631",
      "afterPresent": true,
      "after": [
        "Ball of wool"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Balls of wool",
          "to": "Ball of wool"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Thieving",
        "Use an ~|experience lamp|~ from the Waiko Reward Shop on Thieving",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Ports XP Lamp"
      ],
      "beforeRecordSha256": "74a495b52d37cba62781ca089828f025d9cc66ac856a9aa5642885d4d64cf7df",
      "afterPresent": true,
      "after": [
        "Ports XP lamp"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Ports XP Lamp",
          "to": "Ports XP lamp"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Thieving",
        "Make a ~|Milestone cape (90)|~",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Balls of wool"
      ],
      "beforeRecordSha256": "b15806d75ac540937a0d66fc3735735c15200125abdd02e5bf8be93526f50631",
      "afterPresent": true,
      "after": [
        "Ball of wool"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Balls of wool",
          "to": "Ball of wool"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Thieving",
        "Pickpocket a ~|Menaphite thug|~ for quadruple loot",
        "Monsters"
      ],
      "beforePresent": true,
      "before": [
        "Menaphite thug"
      ],
      "beforeRecordSha256": "92fce8c99cc163251f4bf42493ae62232507ca37b05f778af11980044a6c6895",
      "afterPresent": true,
      "after": [
        "Menaphite Thug"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Menaphite thug",
          "to": "Menaphite Thug"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Woodcutting",
        "Use an ~|inferno Adze|~",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Inferno Adze"
      ],
      "beforeRecordSha256": "579c8faba560bae3fc217e9e05e92012fe4d8c5783dbafb87dfab16b617697b7",
      "afterPresent": true,
      "after": [
        "Inferno adze"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Inferno Adze",
          "to": "Inferno adze"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Woodcutting",
        "Make a ~|Milestone cape (90)|~",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Balls of wool"
      ],
      "beforeRecordSha256": "b15806d75ac540937a0d66fc3735735c15200125abdd02e5bf8be93526f50631",
      "afterPresent": true,
      "after": [
        "Ball of wool"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Balls of wool",
          "to": "Ball of wool"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Diary",
        "~|Completionist achievements#Trimmed Completionist Cape|~ Mitts and Waders - Death Lotus",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Death Lotus gloves scroll",
        "Death lotus boots scroll"
      ],
      "beforeRecordSha256": "40861f5f2286eba045088e00ac7f42999f6abffd5543924b9774930d807fc921",
      "afterPresent": true,
      "after": [
        "Death Lotus gloves scroll",
        "Death Lotus boots scroll"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Death lotus boots scroll",
          "to": "Death Lotus boots scroll"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Diary",
        "~|Skills achievements#Archaeology|~ Artiefax: Guthixian I",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Lunar calendar",
        "Wolf statuette",
        "Ivory sickle",
        "Nakkirian seal",
        "Royal Game of Ba",
        "Backstrap loom",
        "Animal doll",
        "Initiat's kaunake"
      ],
      "beforeRecordSha256": "3386d8d0b8725d497d3dfe6d7e0cf8a817685d9133f1511fdfa9465db21929ad",
      "afterPresent": true,
      "after": [
        "Lunar calendar",
        "Wolf statuette",
        "Ivory sickle",
        "Nakkirian seal",
        "Royal Game of Ba",
        "Backstrap loom",
        "Animal doll",
        "Initiate's kaunake"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Initiat's kaunake",
          "to": "Initiate's kaunake"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Diary",
        "~|Skills achievements#Archaeology|~ Breaking the Sound Barrier",
        "Chunks"
      ],
      "beforePresent": true,
      "before": [
        "Stomguard Citadel"
      ],
      "beforeRecordSha256": "4dc04955abe3b44b379ce02c52d228685cb67033f45fb6b5ef205b0c7d4e6143",
      "afterPresent": true,
      "after": [
        "Stormguard Citadel"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Stomguard Citadel",
          "to": "Stormguard Citadel"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Diary",
        "~|Skills achievements#Archaeology|~ Velucia: Museum - Guthixian I",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Lunar calendar",
        "Wolf statuette",
        "Ivory sickle",
        "Nakkirian seal",
        "Royal Game of Ba",
        "Backstrap loom",
        "Animal doll",
        "Initiat's kaunake"
      ],
      "beforeRecordSha256": "3386d8d0b8725d497d3dfe6d7e0cf8a817685d9133f1511fdfa9465db21929ad",
      "afterPresent": true,
      "after": [
        "Lunar calendar",
        "Wolf statuette",
        "Ivory sickle",
        "Nakkirian seal",
        "Royal Game of Ba",
        "Backstrap loom",
        "Animal doll",
        "Initiate's kaunake"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Initiat's kaunake",
          "to": "Initiate's kaunake"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Diary",
        "~|Skills achievements#Dungeoneering|~ Very Resourceful",
        "Chunks"
      ],
      "beforePresent": true,
      "before": [
        "Edgeville Dungeon chaos druids dungeon",
        "Dwarven Mine resource dungeon",
        "Edgeville Dungeon hill giants dungeon",
        "Karamja Volcano resource dungeon",
        "13880",
        "Baxtorian Falls resource dungeon",
        "Mining Guild resource dungeon",
        "'Rum'geon",
        "Taverley hellhound resource dungeon",
        "Taverley blue dragon resource dungeon",
        "Varrock Sewers resource dungeon",
        "Dragontooth Island resource dungeon",
        "Chaos Tunnels resource dungeon",
        "Al Kharid resource dungeon",
        "Brimhaven Dungeon resource dungeon",
        "Polypore Dungeon resource dungeon",
        "Asgarnian Ice Dungeon resource dungeon",
        "Kal'gerion resource dungeon",
        "Gorajo resource dungeon",
        "Edimmu resource dungeon",
        "Morytania Slayer Tower dungeon"
      ],
      "beforeRecordSha256": "75eca133fe907685f7f547bc211ba6f84491f7271906e0242ccebe9db323617b",
      "afterPresent": true,
      "after": [
        "Edgeville Dungeon chaos druids dungeon",
        "Dwarven Mine resource dungeon",
        "Edgeville Dungeon hill giant dungeon",
        "Karamja Volcano resource dungeon",
        "13880",
        "Baxtorian Falls resource dungeon",
        "Mining Guild resource dungeon",
        "'Rum'geon",
        "Taverley hellhound resource dungeon",
        "Taverley blue dragon resource dungeon",
        "Varrock Sewers resource dungeon",
        "Dragontooth Island resource dungeon",
        "Chaos Tunnels resource dungeon",
        "Al Kharid resource dungeon",
        "Brimhaven Dungeon resource dungeon",
        "Polypore Dungeon resource dungeon",
        "Asgarnian Ice Dungeon resource dungeon",
        "Kal'gerion resource dungeon",
        "Gorajo resource dungeon",
        "Edimmu resource dungeon",
        "Morytania Slayer Tower dungeon"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Edgeville Dungeon hill giants dungeon",
          "to": "Edgeville Dungeon hill giant dungeon"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Diary",
        "~|Skills achievements#Summoning|~ Gold",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Blue charm",
        "Pouch",
        "Spirit shards",
        "Wolf bones",
        "Raw chicken",
        "Spider carcass",
        "Thin snail",
        "Iron ore",
        "Proboscis",
        "Jackalope antlers",
        "Marigolds",
        "Raw bird meat",
        "Swamp toad",
        "Tortoise shell",
        "Polar kebbit fir",
        "Pack pig tooth",
        "Prayer pig tooth",
        "War pig tooth"
      ],
      "beforeRecordSha256": "cdfc8c9662fdba25325d66c0f1a8c97e003ae8212d4672ca7b977b690a9754fa",
      "afterPresent": true,
      "after": [
        "Blue charm",
        "Pouch",
        "Spirit shards",
        "Wolf bones",
        "Raw chicken",
        "Spider carcass",
        "Thin snail",
        "Iron ore",
        "Proboscis",
        "Jackalope antlers",
        "Marigolds",
        "Raw bird meat",
        "Swamp toad",
        "Tortoise shell",
        "Polar kebbit fur",
        "Pack pig tooth",
        "Prayer pig tooth",
        "War pig tooth"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Polar kebbit fir",
          "to": "Polar kebbit fur"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Diary",
        "~|Activities achievements#Player-Owned Port|~ Death Lotus Assassin",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Superior Death Lotus hood",
        "Superior Death Lotus chestplate",
        "Superior Death Lotus chaps",
        "Superior death lotus tekoh",
        "Superior death lotus tabi",
        "Death Lotus boots scroll",
        "Death Lotus gloves scroll",
        "Death lotus dart",
        "Off-hand death lotus dart"
      ],
      "beforeRecordSha256": "48ad63b299fd997580e29b846321c5d0c9858ccd5d6dc6dd59e992368dccb632",
      "afterPresent": true,
      "after": [
        "Superior Death Lotus hood",
        "Superior Death Lotus chestplate",
        "Superior Death Lotus chaps",
        "Superior death lotus tekoh",
        "Superior death lotus tabi",
        "Death Lotus boots scroll",
        "Death Lotus gloves scroll",
        "Death Lotus dart",
        "Off-hand Death Lotus dart"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Death lotus dart",
          "to": "Death Lotus dart"
        },
        {
          "from": "Off-hand death lotus dart",
          "to": "Off-hand Death Lotus dart"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Diary",
        "~|Activities achievements#Player-Owned Port|~ Tetsu Warrior",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Superior tetsu helm",
        "Superior tetsu body",
        "Superior tetsu platelegs",
        "Superior tetsu kote",
        "Superior tetsu kogake",
        "Tetsu boots scroll",
        "Tetsu gloves scroll",
        "Tetsu katana",
        "Tetzu wakizashi"
      ],
      "beforeRecordSha256": "2182adf29cc6b6a1fe915dfedb61542a6d3a45493a28ca2dffc12d568be710d1",
      "afterPresent": true,
      "after": [
        "Superior tetsu helm",
        "Superior tetsu body",
        "Superior tetsu platelegs",
        "Superior tetsu kote",
        "Superior tetsu kogake",
        "Tetsu boots scroll",
        "Tetsu gloves scroll",
        "Tetsu katana",
        "Tetsu wakizashi"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Tetzu wakizashi",
          "to": "Tetsu wakizashi"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Diary",
        "~|Combat achievements#Bosses (L-Z)|~ Should've Wandered Somewhere Else VI",
        "Monsters"
      ],
      "beforePresent": true,
      "before": [
        "Kezalam,the Wanderer (Hard Mode)"
      ],
      "beforeRecordSha256": "cff55ab9b76c560efc7116bfd21b7d7c18629a9cb8d073efbe25a121e32e73fd",
      "afterPresent": true,
      "after": [
        "Kezalam, the Wanderer (Hard Mode)"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Kezalam,the Wanderer (Hard Mode)",
          "to": "Kezalam, the Wanderer (Hard Mode)"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Diary",
        "~|Combat achievements#Temple of Aminishi|~ Oops! Wrong Cult!",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "H.A.M. hood",
        "H.A.M. shirt",
        "H.A.M. robe",
        "H.A.M. gloves",
        "H.A.M. boots",
        "G.A.M. cloak"
      ],
      "beforeRecordSha256": "e6fc13ed247f18d5e5bdff6f98ae38039319221aa83d1cb314f9659759f841e3",
      "afterPresent": true,
      "after": [
        "H.A.M. hood",
        "H.A.M. shirt",
        "H.A.M. robe",
        "H.A.M. gloves",
        "H.A.M. boots",
        "H.A.M. cloak"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "G.A.M. cloak",
          "to": "H.A.M. cloak"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Diary",
        "~|Combat achievements#Misc|~ Unlocking Expertise",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Codex Ultimatus",
        "Tuska's Wrath ability codex",
        "Mazcab ability codex",
        "Reprisal ability codex",
        "Bladed Dive ability",
        "Greater Fury ability codex",
        "Great Flurry ability codex",
        "Greater Barge ability codex",
        "Divert ability codex",
        "Greater Chain ability codex",
        "Greater Ricochet ability codex",
        "Greater Concentrated blast ability codex",
        "Magma Tempest ability codex",
        "Chaos Roar ability codex",
        "Greater Death's Swiftness ability codex",
        "Greater Sunshine ability codex",
        "Greater Sonic Wave ability codex"
      ],
      "beforeRecordSha256": "f43491e9049b3e0d123dcf479af0d8ee320b7e6ce0136365dae15be3808f77ea",
      "afterPresent": true,
      "after": [
        "Codex Ultimatus",
        "Tuska's Wrath ability codex",
        "Mazcab ability codex",
        "Reprisal ability codex",
        "Bladed Dive ability",
        "Greater Fury ability codex",
        "Greater Flurry ability codex",
        "Greater Barge ability codex",
        "Divert ability codex",
        "Greater Chain ability codex",
        "Greater Ricochet ability codex",
        "Greater Concentrated blast ability codex",
        "Magma Tempest ability codex",
        "Chaos Roar ability codex",
        "Greater Death's Swiftness ability codex",
        "Greater Sunshine ability codex",
        "Greater Sonic Wave ability codex"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Great Flurry ability codex",
          "to": "Greater Flurry ability codex"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Extra",
        "~|hidey-hole|~: Tai Bwo Wannai village",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Mithril med helm",
        "Green dragonhide chaps",
        "Ring of dueling"
      ],
      "beforeRecordSha256": "93a35ae70cdac5d6467279d3017074d7ed2ac87dec0989fa773067a5f9f61c99",
      "afterPresent": true,
      "after": [
        "Mithril med helm",
        "Green dragonhide chaps",
        "Ring of duelling"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Ring of dueling",
          "to": "Ring of duelling"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Extra",
        "Find ~|idocrase|~",
        "NPCs"
      ],
      "beforePresent": true,
      "before": [
        "Charnak",
        "Imhapi",
        "Danwad",
        "Amunemen",
        "Danlozep",
        "Khattak",
        "Inhamat",
        "Anhur",
        "Hieromonk Genjiro",
        "Lisah",
        "Khamud",
        "Banafrit",
        "Captain Harkhebi",
        "Menhet",
        "Kharl",
        "Jhonathan",
        "Adoratrice Haruko",
        "Nefertari",
        "Malala",
        "Sabrina",
        "Sensei Hakase",
        "Psamtik",
        "Sennefer",
        "Henutemipet",
        "Pia",
        "Tefibi",
        "Hisamitsu",
        "Septhys",
        "Strykewyrm Jim",
        "Lokkir",
        "Makhredrup",
        "Olivia",
        "Rhotep"
      ],
      "beforeRecordSha256": "4f2ff9dfef5dae564cb0436d875518aeec29482232e6f0909dd2aa34cf89a792",
      "afterPresent": true,
      "after": [
        "Charnak",
        "Imhapi",
        "Danwad",
        "Amunemen",
        "Danlozep",
        "Khattak",
        "Inhamat",
        "Anhur",
        "Hieromonk Genjiro",
        "Lisah",
        "Khamud",
        "Banafrit",
        "Captain Harkhebi",
        "Menhet",
        "Kharl",
        "Jhonatan",
        "Adoratrice Haruko",
        "Nefertari",
        "Malala",
        "Sabrina",
        "Sensei Hakase",
        "Psamtik",
        "Sennefer",
        "Henutemipet",
        "Pia",
        "Tefibi",
        "Hisamitsu",
        "Septhys",
        "Strykewyrm Jim",
        "Lokkir",
        "Makhredrup",
        "Olivia",
        "Rhotep"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Jhonathan",
          "to": "Jhonatan"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Extra",
        "(Solak) Obtain an ~|off-hand blightbound crossbow|~",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Off-hand blightbound crossbow"
      ],
      "beforeRecordSha256": "3b7aa579d14a96f0a86e376f6316c04547e111dd5b035b7559598277503be7ce",
      "afterPresent": true,
      "after": [
        "Off-hand Blightbound crossbow"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Off-hand blightbound crossbow",
          "to": "Off-hand Blightbound crossbow"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Extra",
        "(Zamorakian Undercity) Obtain a ~|silver of pain|~",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Silver of pain"
      ],
      "beforeRecordSha256": "bb3234f314b3f9ceac9638caa9593f91972db72afb6124d37f9571d1fcc8da3c",
      "afterPresent": true,
      "after": [
        "Sliver of pain"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Silver of pain",
          "to": "Sliver of pain"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Extra",
        "(Zamorakian Undercity) Obtain a ~|silver of power|~",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Silver of power"
      ],
      "beforeRecordSha256": "0eb38d0fcd4c2268e2c328134a4041d5fbac553693f3e6955b089898c8c7ce74",
      "afterPresent": true,
      "after": [
        "Sliver of power"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Silver of power",
          "to": "Sliver of power"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Extra",
        "(Zamorakian Undercity) Obtain a ~|silver of strength|~",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Silver of strength"
      ],
      "beforeRecordSha256": "f0313798dfb06074c7b2926d3fbc2523f76f2b477381c232ad0bb6b8b0700789",
      "afterPresent": true,
      "after": [
        "Sliver of strength"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Silver of strength",
          "to": "Sliver of strength"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Extra",
        "(Boss Trophies) Obtain ~|The Gate of Elidinis (trophy)|~",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "The Gate of Elidinis (trohpy)"
      ],
      "beforeRecordSha256": "a0f03274dcd46fd21ba70425c5cb95e9bffc69c13d3a5b919d4132788fffa805",
      "afterPresent": true,
      "after": [
        "The Gate of Elidinis (trophy)"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "The Gate of Elidinis (trohpy)",
          "to": "The Gate of Elidinis (trophy)"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Extra",
        "Collect a ~|infernal mage|~ soul",
        "Monster"
      ],
      "beforePresent": true,
      "before": [
        "Infernal mage"
      ],
      "beforeRecordSha256": "0d7b866133c17483466cbce1296d250331b044d475d5c78a11f40679bd35c1d9",
      "afterPresent": true,
      "after": [
        "Infernal Mage"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Infernal mage",
          "to": "Infernal Mage"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Extra",
        "Collect an ~|acheron mammoth|~ soul",
        "Monster"
      ],
      "beforePresent": true,
      "before": [
        "Acheron Mammoth"
      ],
      "beforeRecordSha256": "d23c55715df29b35b532b9439f9c7d6ed5b2771db34b1add5dc1a55acd10261e",
      "afterPresent": true,
      "after": [
        "Acheron mammoth"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Acheron Mammoth",
          "to": "Acheron mammoth"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Extra",
        "Collect a ~|feral dinosaur|~ soul",
        "Monster"
      ],
      "beforePresent": true,
      "before": [
        "Feral dinosaur"
      ],
      "beforeRecordSha256": "6d3ff4fdb1a2b874e87096713a00d855af542ce66f05441d8d2f809c37e8267b",
      "afterPresent": true,
      "after": [
        "Feral Dinosaur"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Feral dinosaur",
          "to": "Feral Dinosaur"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Extra",
        "Obtain the ~|of the Amlodd|~ title",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Light creautre pouch",
        "Light Creature scroll (Enlightenment)"
      ],
      "beforeRecordSha256": "7cb3c6664251bac104f2de4793693157d01a1547112e5182f3bd2859105d0f62",
      "afterPresent": true,
      "after": [
        "Light creature pouch",
        "Light Creature scroll (Enlightenment)"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Light creautre pouch",
          "to": "Light creature pouch"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Extra",
        "Obtain the ~|Final Boss|~ title",
        "Monsters"
      ],
      "beforePresent": true,
      "before": [
        "Amascut, the Devourer",
        "Giant mole",
        "Chaos Elemental",
        "King Black Dragon",
        "Queen Black Dragon",
        "Corporeal Beast",
        "Dagannoth Rex",
        "Orikalka",
        "Osseous",
        "Barrows",
        "TzTok-Jad",
        "Har-Aken",
        "The Magister",
        "Araxxi",
        "Legio Primus",
        "Raksha, the Shadow Colossus",
        "Barrows: Rise of the Six",
        "Zemouregal & Vorkath",
        "The Gate of Elidinis",
        "Solak, Guardian of the Grove",
        "Vorago",
        "Kalphite King",
        "Kalphite Queen",
        "Hermod, the Spirit of War",
        "Rasial, the First Necromancer",
        "The Sanctum Guardian",
        "Masuta the Ascended",
        "Seiryu the Azure Serpent",
        "Astellarn",
        "Verak Lith",
        "Black Stone Dragon",
        "Crassian Leviathan",
        "Taraket the Necromancer",
        "The Ambassador",
        "Kree'arra",
        "K'ril Tsutsaroth",
        "General Graardor",
        "Commander Zilyana",
        "Nex",
        "Nex: Angel of Death",
        "Helwyr",
        "Gregorovic",
        "Twin Furies",
        "Vindicta",
        "Telos, the Warden",
        "Arch-Glacor",
        "Croesus",
        "Kerapac, the bound",
        "TzKal-Zuk",
        "Zamorak, Lord of Chaos",
        "Vermyx, Brood Mother",
        "Kezalam, the Wanderer",
        "Nakatra, Devourer Eternal",
        "Beastmaster Durzag",
        "Yakamaru",
        "Flesh-hatcher Mhekarnahz",
        "Ivar, King of Bones",
        "Silverquill, the Dreadhog"
      ],
      "beforeRecordSha256": "ef4aa3789f4d2d9b23b2acb1a2b777bc1d2a05ba7634723358924858dd94cde5",
      "afterPresent": true,
      "after": [
        "Amascut, the Devourer",
        "Giant mole",
        "Chaos Elemental",
        "King Black Dragon",
        "Queen Black Dragon",
        "Corporeal Beast",
        "Dagannoth Rex",
        "Orikalka",
        "Osseous",
        "Barrows",
        "TzTok-Jad",
        "Har-Aken",
        "The Magister",
        "Araxxi",
        "Legio Primus",
        "Raksha, the Shadow Colossus",
        "Barrows: Rise of the Six",
        "Zemouregal & Vorkath",
        "The Gate of Elidinis",
        "Solak, Guardian of the Grove",
        "Vorago",
        "Kalphite King",
        "Kalphite Queen",
        "Hermod, the Spirit of War",
        "Rasial, the First Necromancer",
        "The Sanctum Guardian",
        "Masuta the Ascended",
        "Seiryu the Azure Serpent",
        "Astellarn",
        "Verak Lith",
        "Black Stone Dragon",
        "Crassian Leviathan",
        "Taraket the Necromancer",
        "The Ambassador",
        "Kree'arra",
        "K'ril Tsutsaroth",
        "General Graardor",
        "Commander Zilyana",
        "Nex",
        "Nex, Angel of Death",
        "Helwyr",
        "Gregorovic",
        "Twin Furies",
        "Vindicta",
        "Telos, the Warden",
        "Arch-Glacor",
        "Croesus",
        "Kerapac, the bound",
        "TzKal-Zuk",
        "Zamorak, Lord of Chaos",
        "Vermyx, Brood Mother",
        "Kezalam, the Wanderer",
        "Nakatra, Devourer Eternal",
        "Beastmaster Durzag",
        "Yakamaru",
        "Flesh-hatcher Mhekarnahz",
        "Ivar, King of Bones",
        "Silverquill, the Dreadhog"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Nex: Angel of Death",
          "to": "Nex, Angel of Death"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Extra",
        "Obtain the ~|Insane Final Boss|~ title",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "King black dragon scale",
        "Kalphite egg",
        "Shrivelled dagannoth claw",
        "Dagannoth egg",
        "Dagannoth scale",
        "Ribs of chaos",
        "Rotten fang",
        "Giant feather",
        "Auburn lock",
        "Decaying tooth",
        "Severed hoof",
        "Blood-soaked feather",
        "Blood tentacle",
        "Corporeal bone",
        "Volcanic shard",
        "Queen Black Dragon scale",
        "Kalphite claw",
        "Corrupted Ascension signet I",
        "Corrupted Ascension signet II",
        "Corrupted Ascension signet III",
        "Corrupted Ascension signet IV",
        "Corrupted Ascension signet V",
        "Corrupted Ascension signet VI",
        "Ancient summoning stone",
        "Ancient artefact",
        "Araxyte egg",
        "Durzag's helmet",
        "Yakamaru's helmet",
        "Faceless mask",
        "Twisted antler",
        "Avaryss' braid",
        "Nymora's braid",
        "Imbued blade slice",
        "Glimmering scale",
        "Telos' tendril",
        "Soul fragment",
        "Imbued bark shard",
        "Chipped black stone crystal",
        "Inert black stone crystal",
        "Umbral urn",
        "Broken shackle",
        "Pristine Bagrada rex egg",
        "Pristine Pavosaurus rex egg",
        "Pristine Corbicula rex egg",
        "Kerapac's mask piece",
        "Glacor core",
        "Croesus' enriched root",
        "TzKal-Zuk's armour piece",
        "Jewels of Zamorak",
        "Hermod's armour spike",
        "Miso's collar",
        "Vorkath's claw",
        "Calcified heart",
        "Nefthys' Tooth",
        "Fragment of the Gate",
        "Amascut's promise",
        "Mhekarnahz's eye",
        "Ivar's loincloth",
        "Silverquill's blood-filled cyst"
      ],
      "beforeRecordSha256": "26fcb36d0ed49a2e78a6eafcda2524da7996c61a2fe133eee9245ee72985e783",
      "afterPresent": true,
      "after": [
        "King black dragon scale",
        "Kalphite egg",
        "Shrivelled dagannoth claw",
        "Dagannoth egg",
        "Dagannoth scale",
        "Ribs of chaos",
        "Rotten fang",
        "Giant feather",
        "Auburn lock",
        "Decaying tooth",
        "Severed hoof",
        "Blood-soaked feather",
        "Blood tentacle",
        "Corporeal bone",
        "Volcanic shard",
        "Queen Black Dragon scale",
        "Kalphite claw",
        "Corrupted Ascension signet I",
        "Corrupted Ascension signet II",
        "Corrupted Ascension signet III",
        "Corrupted Ascension signet IV",
        "Corrupted Ascension signet V",
        "Corrupted Ascension signet VI",
        "Ancient summoning stone",
        "Ancient artefact",
        "Araxyte egg",
        "Durzag's helmet",
        "Yakamaru's helmet",
        "Faceless mask",
        "Twisted antler",
        "Avaryss' braid",
        "Nymora's braid",
        "Imbued blade slice",
        "Glimmering scale",
        "Telos' tendril",
        "Soul fragment",
        "Imbued bark shard",
        "Chipped black stone crystal",
        "Inert black stone crystal",
        "Umbral urn",
        "Broken shackle",
        "Pristine Bagrada rex egg",
        "Pristine Pavosaurus rex egg",
        "Pristine Corbicula rex egg",
        "Kerapac's mask piece",
        "Glacor core",
        "Croesus's enriched root",
        "TzKal-Zuk's armour piece",
        "Jewels of Zamorak",
        "Hermod's armour spike",
        "Miso's collar",
        "Vorkath's claw",
        "Calcified heart",
        "Nefthys' Tooth",
        "Fragment of the Gate",
        "Amascut's promise",
        "Mhekarnahz's eye",
        "Ivar's loincloth",
        "Silverquill's blood-filled cyst"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Croesus' enriched root",
          "to": "Croesus's enriched root"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Extra",
        "Obtain the ~|Insane Final Boss|~ title",
        "Monsters"
      ],
      "beforePresent": true,
      "before": [
        "Amascut, the Devourer",
        "Giant mole",
        "Giant mole (Hard Mode)",
        "Chaos Elemental",
        "King Black Dragon",
        "Queen Black Dragon",
        "Corporeal Beast",
        "Dagannoth Rex",
        "Orikalka",
        "Osseous",
        "Barrows",
        "TzTok-Jad",
        "Har-Aken",
        "The Magister",
        "Araxxi",
        "Legio Primus",
        "Raksha, the Shadow Colossus",
        "Barrows: Rise of the Six",
        "Zemouregal & Vorkath",
        "Zemouregal & Vorkath (Hard Mode)",
        "The Gate of Elidinis",
        "Solak, Guardian of the Grove",
        "Vorago",
        "Vorago (Hard Mode)",
        "Kalphite King",
        "Kalphite Queen",
        "Hermod, the Spirit of War",
        "Rasial, the First Necromancer",
        "The Sanctum Guardian",
        "Masuta the Ascended",
        "Seiryu the Azure Serpent",
        "Astellarn",
        "Verak Lith",
        "Black Stone Dragon",
        "Crassian Leviathan",
        "Taraket the Necromancer",
        "The Ambassador",
        "Kree'arra",
        "Kree'arra (Hard Mode)",
        "K'ril Tsutsaroth",
        "K'ril Tsutsaroth (Hard Mode)",
        "General Graardor",
        "General Graardor (Hard Mode)",
        "Commander Zilyana",
        "Commander Zilyana (Hard Mode)",
        "Nex",
        "Nex: Angel of Death",
        "Helwyr",
        "Helwyr (Hard Mode)",
        "Gregorovic",
        "Gregorovic (Hard Mode)",
        "Twin Furies",
        "Twin Furies (Hard Mode)",
        "Vindicta (Hard Mode)",
        "Vindicta",
        "Telos, the Warden",
        "Arch-Glacor",
        "Arch-Glacor (Hard Mode)",
        "Croesus",
        "Kerapac, the bound",
        "Kerapac, the bound (Hard Mode)",
        "TzKal-Zuk",
        "TzKal-Zuk (Hard Mode)",
        "Zamorak, Lord of Chaos",
        "Vermyx, Brood Mother",
        "Vermyx, Brood Mother (Hard Mode)",
        "Kezalam, the Wanderer",
        "Kezalam, the Wanderer (Hard Mode)",
        "Nakatra, Devourer Eternal",
        "Nakatra, Devourer Eternal (Hard Mode)",
        "Beastmaster Durzag",
        "Yakamaru",
        "Flesh-hatcher Mhekarnahz",
        "Ivar, King of Bones",
        "Silverquill, the Dreadhog"
      ],
      "beforeRecordSha256": "dc4dbad2dd983f97bb3c6d5e186099790cfb21da49a2f58133e2b4bfc5b554ed",
      "afterPresent": true,
      "after": [
        "Amascut, the Devourer",
        "Giant mole",
        "Giant mole (Hard Mode)",
        "Chaos Elemental",
        "King Black Dragon",
        "Queen Black Dragon",
        "Corporeal Beast",
        "Dagannoth Rex",
        "Orikalka",
        "Osseous",
        "Barrows",
        "TzTok-Jad",
        "Har-Aken",
        "The Magister",
        "Araxxi",
        "Legio Primus",
        "Raksha, the Shadow Colossus",
        "Barrows: Rise of the Six",
        "Zemouregal & Vorkath",
        "Zemouregal & Vorkath (Hard Mode)",
        "The Gate of Elidinis",
        "Solak, Guardian of the Grove",
        "Vorago",
        "Vorago (Hard Mode)",
        "Kalphite King",
        "Kalphite Queen",
        "Hermod, the Spirit of War",
        "Rasial, the First Necromancer",
        "The Sanctum Guardian",
        "Masuta the Ascended",
        "Seiryu the Azure Serpent",
        "Astellarn",
        "Verak Lith",
        "Black Stone Dragon",
        "Crassian Leviathan",
        "Taraket the Necromancer",
        "The Ambassador",
        "Kree'arra",
        "Kree'arra (Hard Mode)",
        "K'ril Tsutsaroth",
        "K'ril Tsutsaroth (Hard Mode)",
        "General Graardor",
        "General Graardor (Hard Mode)",
        "Commander Zilyana",
        "Commander Zilyana (Hard Mode)",
        "Nex",
        "Nex, Angel of Death",
        "Helwyr",
        "Helwyr (Hard Mode)",
        "Gregorovic",
        "Gregorovic (Hard Mode)",
        "Twin Furies",
        "Twin Furies (Hard Mode)",
        "Vindicta (Hard Mode)",
        "Vindicta",
        "Telos, the Warden",
        "Arch-Glacor",
        "Arch-Glacor (Hard Mode)",
        "Croesus",
        "Kerapac, the bound",
        "Kerapac, the bound (Hard Mode)",
        "TzKal-Zuk",
        "TzKal-Zuk (Hard Mode)",
        "Zamorak, Lord of Chaos",
        "Vermyx, Brood Mother",
        "Vermyx, Brood Mother (Hard Mode)",
        "Kezalam, the Wanderer",
        "Kezalam, the Wanderer (Hard Mode)",
        "Nakatra, Devourer Eternal",
        "Nakatra, Devourer Eternal (Hard Mode)",
        "Beastmaster Durzag",
        "Yakamaru",
        "Flesh-hatcher Mhekarnahz",
        "Ivar, King of Bones",
        "Silverquill, the Dreadhog"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Nex: Angel of Death",
          "to": "Nex, Angel of Death"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Extra",
        "Obtain a ~|Brooch of the Gods|~",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Brooch of the Gods"
      ],
      "beforeRecordSha256": "2bca7d1c5236e889cc8497acc8eefd6df4a127965bf6acd5eb4c4b7a694e0e55",
      "afterPresent": true,
      "after": [
        "Brooch of the gods"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Brooch of the Gods",
          "to": "Brooch of the gods"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Extra",
        "Obtain a ~|Ring of Luck|~",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Ring of Luck"
      ],
      "beforeRecordSha256": "16cc66b2813adc291e92b8ece825cb8ddf9278f85de14509e2eb07509720580d",
      "afterPresent": true,
      "after": [
        "Ring of luck"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Ring of Luck",
          "to": "Ring of luck"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Extra",
        "Obtain a ~|blacksmith's apron|~",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Blacksmith's arpon"
      ],
      "beforeRecordSha256": "6e79269a7f33a165c95a48d26ba317e8f3798cb3a14b9b66d561f7bbe47ed20b",
      "afterPresent": true,
      "after": [
        "Blacksmith's apron"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Blacksmith's arpon",
          "to": "Blacksmith's apron"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Extra",
        "Obtain the ~|champion's tacklebox|~",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Champion's tacklebox"
      ],
      "beforeRecordSha256": "fd84764d0274c4424cb6f6d4d95f7c32f905a2e1ff1505cd59727c43e752224b",
      "afterPresent": true,
      "after": [
        "Champion's tackle box"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Champion's tacklebox",
          "to": "Champion's tackle box"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Extra",
        "Obtain the ~|professional tacklebox|~",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Professional tacklebox"
      ],
      "beforeRecordSha256": "4da69bc51bbf99ebed5674762dbefc9bb69ed87dc8365b2764ab74dee2c25bf2",
      "afterPresent": true,
      "after": [
        "Professional tackle box"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Professional tacklebox",
          "to": "Professional tackle box"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Extra",
        "Obtain the ~|standard tacklebox|~",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Standard tacklebox"
      ],
      "beforeRecordSha256": "3a60c398c983a606d27b0a03565a79c6f79f375eefc1479a5a389cb6478a9225",
      "afterPresent": true,
      "after": [
        "Standard tackle box"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Standard tacklebox",
          "to": "Standard tackle box"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Extra",
        "Obtain the ~|basic tacklebox|~",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Basic tacklebox"
      ],
      "beforeRecordSha256": "8d8e7e665dd48960d80c5b12adf6cc7ac0c4cc6fbfb56c98c10b3bdedf3d877b",
      "afterPresent": true,
      "after": [
        "Basic tackle box"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Basic tacklebox",
          "to": "Basic tackle box"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Extra",
        "Obtain the ~|beginner's tacklebox|~",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Beginner's tacklebox"
      ],
      "beforeRecordSha256": "39a578ce1e835b530cfb29c9068272c1d57ab69f6435917b90173e0ce8556e58",
      "afterPresent": true,
      "after": [
        "Beginner's tackle box"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Beginner's tacklebox",
          "to": "Beginner's tackle box"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Extra",
        "Obtain ~|Sana's frytorch|~",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Sana's frytorch"
      ],
      "beforeRecordSha256": "8f71e576be5f2e04707749b2d114fd34ca6fb9f482a62137739f7d3efec48fc3",
      "afterPresent": true,
      "after": [
        "Sana's fyrtorch"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Sana's frytorch",
          "to": "Sana's fyrtorch"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Extra",
        "(Velucia) Complete ~|Museum - Guthixian I|~",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Lunar calendar",
        "Wolf statuette",
        "Ivory sickle",
        "Nakkirian seal",
        "Royal Game of Ba",
        "Backstrap loom",
        "Animal doll",
        "Initiat's kaunake"
      ],
      "beforeRecordSha256": "3386d8d0b8725d497d3dfe6d7e0cf8a817685d9133f1511fdfa9465db21929ad",
      "afterPresent": true,
      "after": [
        "Lunar calendar",
        "Wolf statuette",
        "Ivory sickle",
        "Nakkirian seal",
        "Royal Game of Ba",
        "Backstrap loom",
        "Animal doll",
        "Initiate's kaunake"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Initiat's kaunake",
          "to": "Initiate's kaunake"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Extra",
        "(Artiefax) Complete ~|Guthixian I|~",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Lunar calendar",
        "Wolf statuette",
        "Ivory sickle",
        "Nakkirian seal",
        "Royal Game of Ba",
        "Backstrap loom",
        "Animal doll",
        "Initiat's kaunake"
      ],
      "beforeRecordSha256": "3386d8d0b8725d497d3dfe6d7e0cf8a817685d9133f1511fdfa9465db21929ad",
      "afterPresent": true,
      "after": [
        "Lunar calendar",
        "Wolf statuette",
        "Ivory sickle",
        "Nakkirian seal",
        "Royal Game of Ba",
        "Backstrap loom",
        "Animal doll",
        "Initiate's kaunake"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Initiat's kaunake",
          "to": "Initiate's kaunake"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Nonskill",
        "Create the Hand of Glory (Ring of Luck)*",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Hand of glory[+]",
        "Ring of Luck"
      ],
      "beforeRecordSha256": "43f4b5e2f9fd8ae39187c1132cefcad80eea12b91fed6a020a991e80f3ef9489",
      "afterPresent": true,
      "after": [
        "Hand of glory[+]",
        "Ring of luck"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Ring of Luck",
          "to": "Ring of luck"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Nonskill",
        "Create the Hand of Glory (Ring of Wealth)*",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Hand of glory[+]x2",
        "Ring of Wealth",
        "Ring of Luck"
      ],
      "beforeRecordSha256": "f0bbda92081ea458df4e8084098afb3644a95df7e15b4105453ed397b18b0656",
      "afterPresent": true,
      "after": [
        "Hand of glory[+]x2",
        "Ring of Wealth",
        "Ring of luck"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Ring of Luck",
          "to": "Ring of luck"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Nonskill",
        "Create the Hand of Glory (Ring of Fortune)*",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Hand of glory[+]x3",
        "Ring of Fortune",
        "Ring of Wealth",
        "Ring of Luck"
      ],
      "beforeRecordSha256": "49dbaa88e0ad52a9492546a41aa853732c87801b0a74ebad21e73201613396e9",
      "afterPresent": true,
      "after": [
        "Hand of glory[+]x3",
        "Ring of Fortune",
        "Ring of Wealth",
        "Ring of luck"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Ring of Luck",
          "to": "Ring of luck"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Nonskill",
        "Create the Hand of Glory (Luck of the Dwarves)*",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Hand of glory[+]x4",
        "Luck of the Dwarves",
        "Ring of Fortune",
        "Ring of Wealth",
        "Ring of Luck"
      ],
      "beforeRecordSha256": "11551964d05ed876c631330db6a7d8f23daf45ff00354d7be012a1d3d515cd92",
      "afterPresent": true,
      "after": [
        "Hand of glory[+]x4",
        "Luck of the Dwarves",
        "Ring of Fortune",
        "Ring of Wealth",
        "Ring of luck"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Ring of Luck",
          "to": "Ring of luck"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Nonskill",
        "Complete the archaeology collection 'Museum - Guthixian I'",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Lunar calendar",
        "Wolf statuette",
        "Ivory sickle",
        "Nakkirian seal",
        "Royal Game of Ba",
        "Backstrap loom",
        "Animal doll",
        "Initiat's kaunake"
      ],
      "beforeRecordSha256": "3386d8d0b8725d497d3dfe6d7e0cf8a817685d9133f1511fdfa9465db21929ad",
      "afterPresent": true,
      "after": [
        "Lunar calendar",
        "Wolf statuette",
        "Ivory sickle",
        "Nakkirian seal",
        "Royal Game of Ba",
        "Backstrap loom",
        "Animal doll",
        "Initiate's kaunake"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Initiat's kaunake",
          "to": "Initiate's kaunake"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Nonskill",
        "Complete the archaeology collection 'Guthixian I'",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Lunar calendar",
        "Wolf statuette",
        "Ivory sickle",
        "Nakkirian seal",
        "Royal Game of Ba",
        "Backstrap loom",
        "Animal doll",
        "Initiat's kaunake"
      ],
      "beforeRecordSha256": "3386d8d0b8725d497d3dfe6d7e0cf8a817685d9133f1511fdfa9465db21929ad",
      "afterPresent": true,
      "after": [
        "Lunar calendar",
        "Wolf statuette",
        "Ivory sickle",
        "Nakkirian seal",
        "Royal Game of Ba",
        "Backstrap loom",
        "Animal doll",
        "Initiate's kaunake"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Initiat's kaunake",
          "to": "Initiate's kaunake"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Nonskill",
        "Temple of Aminishi rare loot*",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Lucky charm (Temple of Aminishi)"
      ],
      "beforeRecordSha256": "15fa8a64d1ca9a3b2ddd3325d20d5d90a82626eff7d1337b2732e97d6028a511",
      "afterPresent": true,
      "after": [
        "Lucky Charm (Temple of Aminishi)"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Lucky charm (Temple of Aminishi)",
          "to": "Lucky Charm (Temple of Aminishi)"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Nonskill",
        "Dragonkin Laboratory rare loot*",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Lucky charm (Dragonkin Laboratory)"
      ],
      "beforeRecordSha256": "8e493fa72079ffa309b7bf53191c7b5c59a489ec9f3bb55cff61792dac7bfdbe",
      "afterPresent": true,
      "after": [
        "Lucky Charm (Dragonkin Laboratory)"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Lucky charm (Dragonkin Laboratory)",
          "to": "Lucky Charm (Dragonkin Laboratory)"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Nonskill",
        "Shadow Reef rare loot*",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Lucky charm (Shadow Reef)"
      ],
      "beforeRecordSha256": "660a3cdb838f88b8e9d953c1aac12fa23df4a59eaeb614c4661ebb6638394ebb",
      "afterPresent": true,
      "after": [
        "Lucky Charm (Shadow Reef)"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Lucky charm (Shadow Reef)",
          "to": "Lucky Charm (Shadow Reef)"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Nonskill",
        "Imbue a luck of the dwarves*",
        "Items"
      ],
      "beforePresent": true,
      "before": [
        "Luck of the dwarves",
        "Teci"
      ],
      "beforeRecordSha256": "0f701b739df0c5a099f7cd08d34ee9906c36194fa39bd5c9ea2fcc7a0b3abdd8",
      "afterPresent": true,
      "after": [
        "Luck of the Dwarves",
        "Teci"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Luck of the dwarves",
          "to": "Luck of the Dwarves"
        }
      ]
    },
    {
      "path": [
        "challenges",
        "Nonskill",
        "Unlock City Quests*",
        "NPCs"
      ],
      "beforePresent": true,
      "before": [
        "Charnak",
        "Imhapi",
        "Danwad",
        "Amunemen",
        "Danlozep",
        "Khattak",
        "Inhamat",
        "Anhur",
        "Hieromonk Genjiro",
        "Lisah",
        "Khamud",
        "Banafrit",
        "Captain Harkhebi",
        "Menhet",
        "Kharl",
        "Jhonathan",
        "Adoratrice Haruko",
        "Nefertari",
        "Malala",
        "Sabrina",
        "Sensei Hakase",
        "Psamtik",
        "Sennefer",
        "Henutemipet",
        "Pia",
        "Tefibi",
        "Hisamitsu",
        "Septhys",
        "Strykewyrm Jim",
        "Lokkir",
        "Makhredrup",
        "Olivia",
        "Rhotep"
      ],
      "beforeRecordSha256": "4f2ff9dfef5dae564cb0436d875518aeec29482232e6f0909dd2aa34cf89a792",
      "afterPresent": true,
      "after": [
        "Charnak",
        "Imhapi",
        "Danwad",
        "Amunemen",
        "Danlozep",
        "Khattak",
        "Inhamat",
        "Anhur",
        "Hieromonk Genjiro",
        "Lisah",
        "Khamud",
        "Banafrit",
        "Captain Harkhebi",
        "Menhet",
        "Kharl",
        "Jhonatan",
        "Adoratrice Haruko",
        "Nefertari",
        "Malala",
        "Sabrina",
        "Sensei Hakase",
        "Psamtik",
        "Sennefer",
        "Henutemipet",
        "Pia",
        "Tefibi",
        "Hisamitsu",
        "Septhys",
        "Strykewyrm Jim",
        "Lokkir",
        "Makhredrup",
        "Olivia",
        "Rhotep"
      ],
      "reason": "Exact reference repaired against an existing source/output in the audited namespace.",
      "replacements": [
        {
          "from": "Jhonathan",
          "to": "Jhonatan"
        }
      ]
    },
    {
      "path": [
        "taskUnlocks",
        "Objects",
        "Cooking range",
        "12850-1"
      ],
      "beforePresent": true,
      "before": [
        {
          "~|Cooks' Assistant|~ Complete the quest": "Quest"
        }
      ],
      "beforeRecordSha256": "ab844d53e6b3e04bc6508e05db7a8e221c0200554d77fde6f5427541953776e0",
      "afterPresent": true,
      "after": [
        {
          "~|Cook's Assistant|~ Complete the quest": "Quest"
        }
      ],
      "reason": "Match the existing Cook's Assistant completion task."
    },
    {
      "path": [
        "drops",
        "Black Stone Dragon"
      ],
      "beforePresent": false,
      "afterPresent": true,
      "after": {
        "Reinforced dragon bones": {
          "1": "Always"
        },
        "Dungeoneering token": {
          "500": "Always",
          "5000": "Always"
        },
        "Greater Barge ability codex": {
          "1": "1/83"
        },
        "Draconic energy": {
          "4-8": "505/1000",
          "7-11": "250/1000",
          "11-19": "150/1000",
          "20-40": "80/1000",
          "40-60": "10/1000",
          "90-110": "5/1000"
        },
        "Inert black stone crystal": {
          "1": "1/300"
        },
        "Uncut diamond": {
          "10-20 (noted)": "480/1000"
        },
        "Uncut dragonstone": {
          "1-10 (noted)": "300/1000"
        },
        "Uncut onyx": {
          "1": "20/1000"
        },
        "Onyx bolt tips": {
          "50-75": "60/1000"
        },
        "Hydrix bolt tips": {
          "50-75": "40/1000"
        },
        "Perfect gemstone scales": {
          "1": "100/1000"
        },
        "DragonkinLaboratoryAlchablesDropTable+": {
          "1": "340/1000"
        },
        "DragonkinLaboratoryCurrencyDropTable+": {
          "1": "650/1000"
        },
        "DragonkinLaboratorySuppliesDropTable+": {
          "1": "10/1000"
        },
        "DragonkinLaboratoryLuckyCharmDropTable+": {
          "1": "40/1000"
        },
        "Starved ancient effigy": {
          "1": "1/180"
        },
        "Mimic kill token": {
          "1": "1/7500"
        },
        "Spirit sapphire": {
          "1": "1/400"
        },
        "Spirit emerald": {
          "1": "1/667"
        },
        "Spirit ruby": {
          "1": "1/1000"
        },
        "RareDropTable+": {
          "1": "1/150"
        },
        "Black Stone Dragon's head": {
          "1": "1/50"
        }
      },
      "reason": "Attach the existing drop table to its exact placed monster name."
    },
    {
      "path": [
        "drops",
        "Black stone dragon"
      ],
      "beforePresent": true,
      "before": {
        "Reinforced dragon bones": {
          "1": "Always"
        },
        "Dungeoneering token": {
          "500": "Always",
          "5000": "Always"
        },
        "Greater Barge ability codex": {
          "1": "1/83"
        },
        "Draconic energy": {
          "4-8": "505/1000",
          "7-11": "250/1000",
          "11-19": "150/1000",
          "20-40": "80/1000",
          "40-60": "10/1000",
          "90-110": "5/1000"
        },
        "Inert black stone crystal": {
          "1": "1/300"
        },
        "Uncut diamond": {
          "10-20 (noted)": "480/1000"
        },
        "Uncut dragonstone": {
          "1-10 (noted)": "300/1000"
        },
        "Uncut onyx": {
          "1": "20/1000"
        },
        "Onyx bolt tips": {
          "50-75": "60/1000"
        },
        "Hydrix bolt tips": {
          "50-75": "40/1000"
        },
        "Perfect gemstone scales": {
          "1": "100/1000"
        },
        "DragonkinLaboratoryAlchablesDropTable+": {
          "1": "340/1000"
        },
        "DragonkinLaboratoryCurrencyDropTable+": {
          "1": "650/1000"
        },
        "DragonkinLaboratorySuppliesDropTable+": {
          "1": "10/1000"
        },
        "DragonkinLaboratoryLuckyCharmDropTable+": {
          "1": "40/1000"
        },
        "Starved ancient effigy": {
          "1": "1/180"
        },
        "Mimic kill token": {
          "1": "1/7500"
        },
        "Spirit sapphire": {
          "1": "1/400"
        },
        "Spirit emerald": {
          "1": "1/667"
        },
        "Spirit ruby": {
          "1": "1/1000"
        },
        "RareDropTable+": {
          "1": "1/150"
        },
        "Black Stone Dragon's head": {
          "1": "1/50"
        }
      },
      "beforeRecordSha256": "5969fe1d8e3a42cff0b190f2e68770fcd347f404ff3da975ee8bae8e71a3fc03",
      "afterPresent": false,
      "reason": "Remove the stranded case-only drop-table key after preserving all its entries."
    },
    {
      "path": [
        "drops",
        "Giant Lobster"
      ],
      "beforePresent": false,
      "afterPresent": true,
      "after": {
        "Tin stone spirit": {
          "3": "4/128"
        },
        "Copper stone spirit": {
          "3": "2/128"
        },
        "Coal stone spirit": {
          "2": "2/128"
        },
        "Iron stone spirit": {
          "1": "2/128"
        },
        "Medium spiky bronze salvage": {
          "1": "6/128"
        },
        "Medium spiky iron salvage": {
          "1": "5/128"
        },
        "Seaweed": {
          "1": "4/128",
          "2": "4/128",
          "5": "2/128"
        },
        "Edible seaweed": {
          "2": "2/128"
        },
        "Oyster": {
          "1": "9/128",
          "2": "12/128"
        },
        "Empty oyster": {
          "1": "3/128",
          "3": "3/128"
        },
        "Oyster pearl": {
          "1": "1/128"
        },
        "Coins": {
          "4": "29/128",
          "8": "6/128",
          "36": "8/128"
        },
        "Fishing bait": {
          "10": "2/128"
        },
        "Opal bolt tips": {
          "5": "2/128"
        },
        "Casket": {
          "1": "1/128"
        },
        "Dead sea slug": {
          "1": "1/128"
        },
        "Spinach roll": {
          "1": "1/128"
        }
      },
      "reason": "Attach the existing drop table to its exact placed monster name."
    },
    {
      "path": [
        "drops",
        "Giant lobster"
      ],
      "beforePresent": true,
      "before": {
        "Tin stone spirit": {
          "3": "4/128"
        },
        "Copper stone spirit": {
          "3": "2/128"
        },
        "Coal stone spirit": {
          "2": "2/128"
        },
        "Iron stone spirit": {
          "1": "2/128"
        },
        "Medium spiky bronze salvage": {
          "1": "6/128"
        },
        "Medium spiky iron salvage": {
          "1": "5/128"
        },
        "Seaweed": {
          "1": "4/128",
          "2": "4/128",
          "5": "2/128"
        },
        "Edible seaweed": {
          "2": "2/128"
        },
        "Oyster": {
          "1": "9/128",
          "2": "12/128"
        },
        "Empty oyster": {
          "1": "3/128",
          "3": "3/128"
        },
        "Oyster pearl": {
          "1": "1/128"
        },
        "Coins": {
          "4": "29/128",
          "8": "6/128",
          "36": "8/128"
        },
        "Fishing bait": {
          "10": "2/128"
        },
        "Opal bolt tips": {
          "5": "2/128"
        },
        "Casket": {
          "1": "1/128"
        },
        "Dead sea slug": {
          "1": "1/128"
        },
        "Spinach roll": {
          "1": "1/128"
        }
      },
      "beforeRecordSha256": "24eed8425036674484aef05f78e2e7de5fa78f9a73ff6e9de54bbdd9c5e58fa0",
      "afterPresent": false,
      "reason": "Remove the stranded case-only drop-table key after preserving all its entries."
    },
    {
      "path": [
        "drops",
        "Mefis, the jailer"
      ],
      "beforePresent": false,
      "afterPresent": true,
      "after": {
        "Bones": {
          "1": "Always"
        },
        "Dungeoneering token": {
          "500": "Always",
          "5000": "Always"
        },
        "ZamorakianUndercityLuckyDropTable+": {
          "1": "2.5/100"
        },
        "ZamorakianUndercityAlchablesDropTable+": {
          "1": "2/5"
        },
        "ZamorakianUndercityRunesDropTable+": {
          "1": "1/4"
        },
        "ZamorakianUndercitySkillingDropTable+": {
          "1": "1/5"
        },
        "ZamorakianUndercitySuppliesDropTable+": {
          "1": "3/20"
        },
        "Sliver of pain": {
          "4-6": "1/100"
        },
        "Sliver of power": {
          "4-6": "1/100"
        },
        "Sliver of strength": {
          "4-6": "1/100"
        },
        "Sealed clue scroll (elite)": {
          "1": "1/36"
        }
      },
      "reason": "Attach the existing drop table to its exact placed monster name."
    },
    {
      "path": [
        "drops",
        "Mefis, the Jailer"
      ],
      "beforePresent": true,
      "before": {
        "Bones": {
          "1": "Always"
        },
        "Dungeoneering token": {
          "500": "Always",
          "5000": "Always"
        },
        "ZamorakianUndercityLuckyDropTable+": {
          "1": "2.5/100"
        },
        "ZamorakianUndercityAlchablesDropTable+": {
          "1": "2/5"
        },
        "ZamorakianUndercityRunesDropTable+": {
          "1": "1/4"
        },
        "ZamorakianUndercitySkillingDropTable+": {
          "1": "1/5"
        },
        "ZamorakianUndercitySuppliesDropTable+": {
          "1": "3/20"
        },
        "Sliver of pain": {
          "4-6": "1/100"
        },
        "Sliver of power": {
          "4-6": "1/100"
        },
        "Sliver of strength": {
          "4-6": "1/100"
        },
        "Sealed clue scroll (elite)": {
          "1": "1/36"
        }
      },
      "beforeRecordSha256": "1846ce4a3e785da8847f1d62244e56808450cfa6c9d36aa184912085925d45a0",
      "afterPresent": false,
      "reason": "Remove the stranded case-only drop-table key after preserving all its entries."
    },
    {
      "path": [
        "drops",
        "TzekHaar-Yt-MejKot"
      ],
      "beforePresent": false,
      "afterPresent": true,
      "after": {
        "Resonant anima of Ful": {
          "9-13": "Always"
        },
        "Resonant anima of Ful (tradeable)": {
          "9-13": "Always"
        },
        "Elder Trove (Ful, T1)": {
          "1": "Varies"
        },
        "Elder Trove (Ful, T2)": {
          "1": "Varies"
        },
        "Elder Trove (Ful, T3)": {
          "1": "Varies"
        },
        "Obsidian charm": {
          "1": "5/100"
        },
        "Tokkul": {
          "10-209": "85/100",
          "1000-1099": "9/100",
          "5000-5499": "1/100"
        },
        "TzekHaarLowValueDropTable+": {
          "1": "180/125"
        },
        "TzekHaarMediumValueDropTable+": {
          "1": "55/125"
        },
        "TzekHaarHighValueDropTable+": {
          "1": "15/125"
        }
      },
      "reason": "Attach the existing drop table to its exact placed monster name."
    },
    {
      "path": [
        "drops",
        "TzekHaar-Yt-Mejkot"
      ],
      "beforePresent": true,
      "before": {
        "Resonant anima of Ful": {
          "9-13": "Always"
        },
        "Resonant anima of Ful (tradeable)": {
          "9-13": "Always"
        },
        "Elder Trove (Ful, T1)": {
          "1": "Varies"
        },
        "Elder Trove (Ful, T2)": {
          "1": "Varies"
        },
        "Elder Trove (Ful, T3)": {
          "1": "Varies"
        },
        "Obsidian charm": {
          "1": "5/100"
        },
        "Tokkul": {
          "10-209": "85/100",
          "1000-1099": "9/100",
          "5000-5499": "1/100"
        },
        "TzekHaarLowValueDropTable+": {
          "1": "180/125"
        },
        "TzekHaarMediumValueDropTable+": {
          "1": "55/125"
        },
        "TzekHaarHighValueDropTable+": {
          "1": "15/125"
        }
      },
      "beforeRecordSha256": "0d6825fe6ed0fa97d964b02e41f278728924975429ba5e76d4e111eb00201933",
      "afterPresent": false,
      "reason": "Remove the stranded case-only drop-table key after preserving all its entries."
    },
    {
      "path": [
        "drops",
        "Undead witch"
      ],
      "beforePresent": false,
      "afterPresent": true,
      "after": {
        "Bones": {
          "1": "Always"
        },
        "ShadowReefCurrencyDropTable+": {
          "1": "350/1000"
        },
        "ShadowReefSuppliesDropTable+": {
          "1": "649.7/1000"
        },
        "ShadowReefLuckyCharmDropTable+": {
          "1": "20/1000"
        },
        "Zombie Champion's scroll": {
          "1": "3/50000000"
        },
        "Starved ancient effigy": {
          "1": "1/6228"
        },
        "Mimic kill token": {
          "1": "1/9830"
        },
        "Spirit sapphire": {
          "1": "1/400"
        },
        "Spirit emerald": {
          "1": "1/667"
        },
        "Spirit ruby": {
          "1": "1/1000"
        },
        "RareDropTable+": {
          "1": "1/150"
        }
      },
      "reason": "Attach the existing drop table to its exact placed monster name."
    },
    {
      "path": [
        "drops",
        "Undead Witch"
      ],
      "beforePresent": true,
      "before": {
        "Bones": {
          "1": "Always"
        },
        "ShadowReefCurrencyDropTable+": {
          "1": "350/1000"
        },
        "ShadowReefSuppliesDropTable+": {
          "1": "649.7/1000"
        },
        "ShadowReefLuckyCharmDropTable+": {
          "1": "20/1000"
        },
        "Zombie Champion's scroll": {
          "1": "3/50000000"
        },
        "Starved ancient effigy": {
          "1": "1/6228"
        },
        "Mimic kill token": {
          "1": "1/9830"
        },
        "Spirit sapphire": {
          "1": "1/400"
        },
        "Spirit emerald": {
          "1": "1/667"
        },
        "Spirit ruby": {
          "1": "1/1000"
        },
        "RareDropTable+": {
          "1": "1/150"
        }
      },
      "beforeRecordSha256": "0d80c12b07aa2977f62a560573a4627340d0f0b39b8ca11253f246b4a325de89",
      "afterPresent": false,
      "reason": "Remove the stranded case-only drop-table key after preserving all its entries."
    },
    {
      "path": [
        "codeItems",
        "itemsPlus",
        "AnyBolt[+]"
      ],
      "beforePresent": true,
      "before": [
        "Bronze bolts",
        "Barbed bolts",
        "Iron bolts",
        "Opal bolts",
        "Blurite bolts",
        "Steel bolts",
        "Pearl Bolts",
        "Opal bolts (e)",
        "Jade bolts",
        "Silver bolts",
        "Black bolts",
        "Mithril bolts",
        "Topaz bolts",
        "Pearl bolts (e)",
        "Jade bolts (e)",
        "Adamant bolts",
        "Sapphire bolts",
        "Topaz bolts (e)",
        "Fragment bolts",
        "Rune bolts",
        "Broad-topped bolts",
        "Emerald bolts",
        "Ruby bolts",
        "Sapphire bolts (e)",
        "Diamond bolts",
        "Dragon bolts",
        "Orikalkum arrow",
        "Emerald bolts (e)",
        "Ruby bolts (e)",
        "Necronium bolts",
        "Onyx bolts",
        "Bane bolts",
        "Abyssalbane bolts",
        "Basiliskbane bolts",
        "Dragonbane bolts",
        "Wallasalkibane bolts",
        "Wyvern spines",
        "Diamond bolts (e)",
        "Dragon bolts (e)",
        "Bakriminel bolts",
        "Royal bolts",
        "Onyx bolts (e)",
        "Opal bakriminel bolts",
        "Pearl bakriminel bolts",
        "Jade bakriminel bolts",
        "Red topaz bakriminel bolts",
        "Sapphire bakriminel bolts",
        "Emerald bakriminel bolts",
        "Ruby bakriminel bolts",
        "Diamond bakriminel bolts",
        "Dragonstone bakriminel bolts",
        "Onyx bakriminel bolts",
        "Hydrix bakriminel bolts",
        "Ascension bolts",
        "Elder rune bolts",
        "Ascendri bolts",
        "Ascendri bolts (e)",
        "Blight bolts",
        "Opal  bakriminel bolts (e)",
        "Pearl bakriminel bolts (e)",
        "Jade bakriminel bolts (e)",
        "Red topaz bakriminel bolts (e)",
        "Sapphire bakriminel bolts (e)",
        "Emerald bakriminel bolts (e)",
        "Ruby bakriminel bolts (e)",
        "Diamond bakriminel bolts (e)",
        "Dragonstone bakriminel bolts (e)",
        "Onyx bakriminel bolts (e)",
        "Hydrix bakriminel bolts (e)",
        "Primal bolts",
        "Havensilver bolts",
        "Havensilver bolts + 1",
        "Havensilver bolts + 1"
      ],
      "beforeRecordSha256": "a24d96e4ab12bcb4ee35fca9d60f7700b80db2dea38a55610276826f641ec2a0",
      "afterPresent": true,
      "after": [
        "Bronze bolts",
        "Barbed bolts",
        "Iron bolts",
        "Opal bolts",
        "Blurite bolts",
        "Steel bolts",
        "Pearl Bolts",
        "Opal bolts (e)",
        "Jade bolts",
        "Silver bolts",
        "Black bolts",
        "Mithril bolts",
        "Topaz bolts",
        "Pearl bolts (e)",
        "Jade bolts (e)",
        "Adamant bolts",
        "Sapphire bolts",
        "Topaz bolts (e)",
        "Fragment bolts",
        "Rune bolts",
        "Broad-topped bolts",
        "Emerald bolts",
        "Ruby bolts",
        "Sapphire bolts (e)",
        "Diamond bolts",
        "Dragon bolts",
        "Orikalkum arrow",
        "Emerald bolts (e)",
        "Ruby bolts (e)",
        "Necronium bolts",
        "Onyx bolts",
        "Bane bolts",
        "Abyssalbane bolts",
        "Basiliskbane bolts",
        "Dragonbane bolts",
        "Wallasalkibane bolts",
        "Wyvern spines",
        "Diamond bolts (e)",
        "Dragon bolts (e)",
        "Bakriminel bolts",
        "Royal bolts",
        "Onyx bolts (e)",
        "Opal bakriminel bolts",
        "Pearl bakriminel bolts",
        "Jade bakriminel bolts",
        "Red topaz bakriminel bolts",
        "Sapphire bakriminel bolts",
        "Emerald bakriminel bolts",
        "Ruby bakriminel bolts",
        "Diamond bakriminel bolts",
        "Dragonstone bakriminel bolts",
        "Onyx bakriminel bolts",
        "Hydrix bakriminel bolts",
        "Ascension bolts",
        "Elder rune bolts",
        "Ascendri bolts",
        "Ascendri bolts (e)",
        "Blight bolts",
        "Opal  bakriminel bolts (e)",
        "Pearl bakriminel bolts (e)",
        "Jade bakriminel bolts (e)",
        "Red topaz bakriminel bolts (e)",
        "Sapphire bakriminel bolts (e)",
        "Emerald bakriminel bolts (e)",
        "Ruby bakriminel bolts (e)",
        "Diamond bakriminel bolts (e)",
        "Dragonstone bakriminel bolts (e)",
        "Onyx bakriminel bolts (e)",
        "Hydrix bakriminel bolts (e)",
        "Primal bolts",
        "Havensilver bolts",
        "Havensilver bolts + 1"
      ],
      "reason": "Alias alternatives count distinct identities; correct the scroll against its existing drop output."
    },
    {
      "path": [
        "codeItems",
        "itemsPlus",
        "ChampionScrolls[+]"
      ],
      "beforePresent": true,
      "before": [
        "Imp Champion's scroll",
        "Zombie Champion's scroll",
        "Skeleton Champion's scroll",
        "Zombie Champion's scroll",
        "Hobgoblin Champion's scroll",
        "Giant Champion's scroll",
        "Banshee Champion's scroll",
        "Ghoul Champion's scroll",
        "Earth Warrior Champion's scroll",
        "Aberant Spectre Champion's scroll",
        "Jogre Champion's scroll",
        "Mummy Champion's scroll",
        "Lesser Demon Champion's scroll"
      ],
      "beforeRecordSha256": "e3238b5610442bed6bf7b0405d5b896413c7d42e054999fac60519b20e062415",
      "afterPresent": true,
      "after": [
        "Imp Champion's scroll",
        "Goblin Champion's scroll",
        "Zombie Champion's scroll",
        "Skeleton Champion's scroll",
        "Hobgoblin Champion's scroll",
        "Giant Champion's scroll",
        "Banshee Champion's scroll",
        "Ghoul Champion's scroll",
        "Earth Warrior Champion's scroll",
        "Aberrant Spectre Champion's scroll",
        "Jogre Champion's scroll",
        "Mummy Champion's scroll",
        "Lesser Demon Champion's scroll"
      ],
      "reason": "Alias alternatives count distinct identities; correct the scroll against its existing drop output."
    },
    {
      "path": [
        "codeItems",
        "itemsPlus",
        "IronWeapon[+]"
      ],
      "beforePresent": true,
      "before": [
        "Iron 2h sword + 1",
        "Iron 2h sword",
        "Iron battleaxe + 1",
        "Iron battleaxe",
        "Iron claws + 1",
        "Iron claws",
        "Iron dagger + 1",
        "Iron dagger",
        "Iron halberd",
        "Iron hasta",
        "Iron hatchet",
        "Iron longsword + 1",
        "Iron longsword",
        "Iron mace",
        "Iron mace",
        "Iron off hand battleaxe + 1",
        "Iron off hand battleaxe",
        "Iron off hand claws + 1",
        "Iron off hand claws",
        "Iron off hand dagger + 1",
        "Iron off hand dagger",
        "Iron off hand longsword + 1",
        "Iron off hand longsword",
        "Iron off hand mace + 1",
        "Iron off hand mace",
        "Iron off hand scimitar + 1",
        "Iron off hand scimitar",
        "Iron off hand sword + 1",
        "Iron off hand sword",
        "Iron off hand warhammer + 1",
        "Iron off hand warhammer",
        "Iron scimitar + 1",
        "Iron scimitar",
        "Iron spear",
        "Iron sword + 1",
        "Iron sword",
        "Iron warhammer + 1",
        "Iron warhammer"
      ],
      "beforeRecordSha256": "6e560c0b10b6fea19ec8546b2c5e3464d2c4187aa05794b6958ceb2063f9e101",
      "afterPresent": true,
      "after": [
        "Iron 2h sword + 1",
        "Iron 2h sword",
        "Iron battleaxe + 1",
        "Iron battleaxe",
        "Iron claws + 1",
        "Iron claws",
        "Iron dagger + 1",
        "Iron dagger",
        "Iron halberd",
        "Iron hasta",
        "Iron hatchet",
        "Iron longsword + 1",
        "Iron longsword",
        "Iron mace",
        "Iron off hand battleaxe + 1",
        "Iron off hand battleaxe",
        "Iron off hand claws + 1",
        "Iron off hand claws",
        "Iron off hand dagger + 1",
        "Iron off hand dagger",
        "Iron off hand longsword + 1",
        "Iron off hand longsword",
        "Iron off hand mace + 1",
        "Iron off hand mace",
        "Iron off hand scimitar + 1",
        "Iron off hand scimitar",
        "Iron off hand sword + 1",
        "Iron off hand sword",
        "Iron off hand warhammer + 1",
        "Iron off hand warhammer",
        "Iron scimitar + 1",
        "Iron scimitar",
        "Iron spear",
        "Iron sword + 1",
        "Iron sword",
        "Iron warhammer + 1",
        "Iron warhammer"
      ],
      "reason": "Alias alternatives count distinct identities; correct the scroll against its existing drop output."
    },
    {
      "path": [
        "codeItems",
        "itemsPlus",
        "Unstrung amulet[+]"
      ],
      "beforePresent": true,
      "before": [
        "Unstrung emblem",
        "Unstrung symbol",
        "Topaz amulet (unstrung)",
        "Rabbit foot",
        "Sapphire amulet (unstrung)",
        "Salve shard",
        "Ruby amulet (unstrung)",
        "Moonstone amulet (unstrung)",
        "Opal amulet (unstrung)",
        "Onyx amulet (unstrung)",
        "Moonstone amulet (unstrung)",
        "Jade amulet (unstrung)",
        "Hydrix amulet (unstrung)",
        "Gold amulet (unstrung)",
        "Emerald amulet (unstrung)",
        "Dragonstone amulet (unstrung)",
        "Diamond amulet (unstrung)"
      ],
      "beforeRecordSha256": "66132898081d37fcc174b4ade873c24e8e2c9f5eec9b9f0ba2cd441ff8662d4a",
      "afterPresent": true,
      "after": [
        "Unstrung emblem",
        "Unstrung symbol",
        "Topaz amulet (unstrung)",
        "Rabbit foot",
        "Sapphire amulet (unstrung)",
        "Salve shard",
        "Ruby amulet (unstrung)",
        "Moonstone amulet (unstrung)",
        "Opal amulet (unstrung)",
        "Onyx amulet (unstrung)",
        "Jade amulet (unstrung)",
        "Hydrix amulet (unstrung)",
        "Gold amulet (unstrung)",
        "Emerald amulet (unstrung)",
        "Dragonstone amulet (unstrung)",
        "Diamond amulet (unstrung)"
      ],
      "reason": "Alias alternatives count distinct identities; correct the scroll against its existing drop output."
    },
    {
      "path": [
        "codeItems",
        "itemsPlus",
        "KnightlyComps[+]"
      ],
      "beforePresent": true,
      "before": [
        "Black 2h crossbow",
        "Black 2h sword",
        "Black 2h battleaxe",
        "Black 2h boots",
        "Black 2h chainbody",
        "Black 2h claw",
        "Black 2h dagger",
        "Black 2h full helm",
        "Black 2h gauntlets",
        "Black 2h hatchet",
        "Black 2h helm",
        "Black 2h kiteshield",
        "Black 2h knife",
        "Black 2h longsword",
        "Black 2h mace",
        "Black 2h platebody",
        "Black 2h platelegs",
        "Black 2h scimitar",
        "Black 2h spear",
        "Black 2h sword",
        "Black 2h warhammer",
        "Chaos relic (rare)",
        "Igneous stone",
        "Laboratory relic (rare)",
        "Reef relic (rare)",
        "Relic of aminishi (rare)",
        "Sanctum of rebirth relic (rare)"
      ],
      "beforeRecordSha256": "6c391ee81465b005b0cef911dbe2f12fa07398a3087db8bd9b94a505164d5997",
      "afterPresent": true,
      "after": [
        "Black 2h crossbow",
        "Black 2h sword",
        "Black 2h battleaxe",
        "Black 2h boots",
        "Black 2h chainbody",
        "Black 2h claw",
        "Black 2h dagger",
        "Black 2h full helm",
        "Black 2h gauntlets",
        "Black 2h hatchet",
        "Black 2h helm",
        "Black 2h kiteshield",
        "Black 2h knife",
        "Black 2h longsword",
        "Black 2h mace",
        "Black 2h platebody",
        "Black 2h platelegs",
        "Black 2h scimitar",
        "Black 2h spear",
        "Black 2h warhammer",
        "Chaos relic (rare)",
        "Igneous stone",
        "Laboratory relic (rare)",
        "Reef relic (rare)",
        "Relic of aminishi (rare)",
        "Sanctum of rebirth relic (rare)"
      ],
      "reason": "Alias alternatives count distinct identities; correct the scroll against its existing drop output."
    },
    {
      "path": [
        "codeItems",
        "itemsPlus",
        "RumblingComps[+]"
      ],
      "beforePresent": true,
      "before": [
        "Dark ice shard",
        "Dark ice sliver",
        "Drygore longsword",
        "Drygore mace",
        "Drygore rapier",
        "Tectonic mask",
        "Tectonic robe bottom",
        "Tectonic robe top",
        "Tectonic robe top",
        "Inquisitor's staff censer",
        "Inquisitor's staff ornament",
        "Inquisitor's staff rod",
        "Spear of Annihilation",
        "Perfect chitin",
        "Primeval boots",
        "Primeval gloves",
        "Primeval mask",
        "Primeval robe legs",
        "Primeval robe top",
        "Superior long bone",
        "Dinosaur scale",
        "Volcanic fragments",
        "Tribal fin",
        "Chaos relic (rare)",
        "Igneous stone",
        "Laboratory relic (rare)",
        "Reef relic (rare)",
        "Relic of aminishi (rare)",
        "Sanctum of rebirth relic (rare)"
      ],
      "beforeRecordSha256": "3ae0d5bf5d74134cbc3bc81164bb0ed7d8f00be7e5abb5fbee9f17a3a8202de4",
      "afterPresent": true,
      "after": [
        "Dark ice shard",
        "Dark ice sliver",
        "Drygore longsword",
        "Drygore mace",
        "Drygore rapier",
        "Tectonic mask",
        "Tectonic robe bottom",
        "Tectonic robe top",
        "Inquisitor's staff censer",
        "Inquisitor's staff ornament",
        "Inquisitor's staff rod",
        "Spear of Annihilation",
        "Perfect chitin",
        "Primeval boots",
        "Primeval gloves",
        "Primeval mask",
        "Primeval robe legs",
        "Primeval robe top",
        "Superior long bone",
        "Dinosaur scale",
        "Volcanic fragments",
        "Tribal fin",
        "Chaos relic (rare)",
        "Igneous stone",
        "Laboratory relic (rare)",
        "Reef relic (rare)",
        "Relic of aminishi (rare)",
        "Sanctum of rebirth relic (rare)"
      ],
      "reason": "Alias alternatives count distinct identities; correct the scroll against its existing drop output."
    },
    {
      "path": [
        "codeItems",
        "npcsPlus",
        "HAMMember[+]"
      ],
      "beforePresent": true,
      "before": [
        "H.A.M. Member",
        "H.A.M. Member"
      ],
      "beforeRecordSha256": "cbc80885f7595275f28a999db5bea5789e0ae849dd7f4be0e38a13f74f888d50",
      "afterPresent": true,
      "after": [
        "H.A.M. Member"
      ],
      "reason": "Alias alternatives count distinct identities; correct the scroll against its existing drop output."
    },
    {
      "path": [
        "challenges",
        "Nonskill",
        "Hard Falador tasks ~|It Spoiled My View|~ (Yew)*",
        "Skills"
      ],
      "beforePresent": true,
      "before": {
        "Farming": 60,
        "Woodcutting": 60
      },
      "beforeRecordSha256": "5b345f20af087ca56e311b0ff91373c675ac6c558cb4880924a2c01692f1765b",
      "afterPresent": true,
      "after": {
        "Farming": 60,
        "Woodcutting": 70
      },
      "reason": "Match the corresponding retained yew/magic log gathering requirement; preserve the separate Farming level."
    },
    {
      "path": [
        "challenges",
        "Nonskill",
        "Hard Falador tasks ~|It Spoiled My View|~ (Magic)*",
        "Skills"
      ],
      "beforePresent": true,
      "before": {
        "Farming": 75,
        "Woodcutting": 75
      },
      "beforeRecordSha256": "391d43ecf7a4d1fb8bdcbedd0e829dc4cf20f371f15de2237e6c30a589c496f4",
      "afterPresent": true,
      "after": {
        "Farming": 75,
        "Woodcutting": 80
      },
      "reason": "Match the corresponding retained yew/magic log gathering requirement; preserve the separate Farming level."
    },
    {
      "path": [
        "slayerMasterTasks",
        "Chaeldar",
        "Jelly"
      ],
      "beforePresent": false,
      "afterPresent": true,
      "after": {
        "Level": 52,
        "Weight": 15
      },
      "reason": "Match the existing assignment mapping and category-qualified prerequisite task; retain existing quest task identities."
    },
    {
      "path": [
        "slayerMasterTasks",
        "Chaeldar",
        "Jellies"
      ],
      "beforePresent": true,
      "before": {
        "Level": 52,
        "Weight": 15
      },
      "beforeRecordSha256": "50fcb7e15929945e8bd9a0d4a94846e1f40c602e3b874131a042fa5094aaec3e",
      "afterPresent": false,
      "reason": "Remove the misspelled assignment key after preserving its requirements and weight."
    },
    {
      "path": [
        "slayerMasterTasks",
        "Sumona",
        "Scabarites"
      ],
      "beforePresent": true,
      "before": {
        "Tasks": {
          "~|Dealing With Scabaras|~ Complete the quest": "Quest"
        },
        "Weight": 5
      },
      "beforeRecordSha256": "e45214ebe911f938a44aaddb423cb5bfeb99ebfb9e84ebfaf54b83364040422d",
      "afterPresent": true,
      "after": {
        "Tasks": {
          "~|Dealing with Scabaras|~ Complete the quest": "Quest"
        },
        "Weight": 5
      },
      "reason": "Match the existing assignment mapping and category-qualified prerequisite task; retain existing quest task identities."
    },
    {
      "path": [
        "slayerMasterTasks",
        "Death",
        "The Magister"
      ],
      "beforePresent": true,
      "before": {
        "Level": 115,
        "CombatLevel": 100,
        "Items": [
          "Key to the Crossing*"
        ],
        "Tasks": {
          "~|Ichtlarin's Little Helper|~ 2": "Quest"
        },
        "Weight": 1
      },
      "beforeRecordSha256": "c20e5e0a8c6aa8af8b51bf0fdba3ade689c7be42a62dc464b119b2c862034e02",
      "afterPresent": true,
      "after": {
        "Level": 115,
        "CombatLevel": 100,
        "Items": [
          "Key to the Crossing*"
        ],
        "Tasks": {
          "~|Icthlarin's Little Helper|~ 2": "Quest"
        },
        "Weight": 1
      },
      "reason": "Match the existing assignment mapping and category-qualified prerequisite task; retain existing quest task identities."
    },
    {
      "path": [
        "slayerMasterTasks",
        "Death",
        "Zemouregal & Vorkath"
      ],
      "beforePresent": false,
      "afterPresent": true,
      "after": {
        "CombatLevel": 125,
        "Tasks": {
          "~|Battle of Forinthry|~ Complete the quest": "Quest"
        },
        "Weight": 1
      },
      "reason": "Match the existing assignment mapping and category-qualified prerequisite task; retain existing quest task identities."
    },
    {
      "path": [
        "slayerMasterTasks",
        "Death",
        "Zamouregal & Vorkath"
      ],
      "beforePresent": true,
      "before": {
        "CombatLevel": 125,
        "Tasks": {
          "~|Battle of Forinthry|~ Complet the quest": "Quest"
        },
        "Weight": 1
      },
      "beforeRecordSha256": "496af04ae862291ffda720dfe9dbdb7ad9e824e6c549da0bfa530e1bf86a28af",
      "afterPresent": false,
      "reason": "Remove the misspelled assignment key after preserving its requirements and weight."
    },
    {
      "path": [
        "slayerMasterTasks",
        "Duradel/Lapalok",
        "Suqahs"
      ],
      "beforePresent": false,
      "afterPresent": true,
      "after": {
        "Tasks": {
          "~|Lunar Diplomacy|~ 6": "Quest"
        },
        "Weight": 5
      },
      "reason": "Match the existing assignment mapping and category-qualified prerequisite task; retain existing quest task identities."
    },
    {
      "path": [
        "slayerMasterTasks",
        "Duradel/Lapalok",
        "Suqah"
      ],
      "beforePresent": true,
      "before": {
        "Tasks": {
          "~|Lunar Diplomacy|~ 6": "Quest"
        },
        "Weight": 5
      },
      "beforeRecordSha256": "9cf82105b47fcd96d6432e4bff60595200a891a739164922c567d35e52b3aefb",
      "afterPresent": false,
      "reason": "Remove the misspelled assignment key after preserving its requirements and weight."
    },
    {
      "path": [
        "slayerMasterTasks",
        "Kuradal",
        "Celestial dragon"
      ],
      "beforePresent": false,
      "afterPresent": true,
      "after": {
        "Tasks": {
          "~|One of a Kind|~ Complete the quest": "Quest"
        },
        "Weight": 10
      },
      "reason": "Match the existing assignment mapping and category-qualified prerequisite task; retain existing quest task identities."
    },
    {
      "path": [
        "slayerMasterTasks",
        "Kuradal",
        "Celestial dragons"
      ],
      "beforePresent": true,
      "before": {
        "Tasks": {
          "~|One of a Kind|~ Complete the quest": "Quest"
        },
        "Weight": 10
      },
      "beforeRecordSha256": "b4a57585d60c124c063da497c1d90c9b6d51b01d6593127a6ff7116f76034d9f",
      "afterPresent": false,
      "reason": "Remove the misspelled assignment key after preserving its requirements and weight."
    },
    {
      "path": [
        "slayerMasterTasks",
        "Kuradal",
        "Corrupted creatures"
      ],
      "beforePresent": true,
      "before": {
        "Level": 98,
        "Tasks": {
          "~|Ichtlarin's Little Helper|~ 1": "Quest"
        },
        "Weight": 10
      },
      "beforeRecordSha256": "b5b2f1c040a388c8fa3072fe9518d7dbce25357b7eb54daa5f786da10201fc7c",
      "afterPresent": true,
      "after": {
        "Level": 98,
        "Tasks": {
          "~|Icthlarin's Little Helper|~ 1": "Quest"
        },
        "Weight": 10
      },
      "reason": "Match the existing assignment mapping and category-qualified prerequisite task; retain existing quest task identities."
    },
    {
      "path": [
        "slayerMasterTasks",
        "Kuradal",
        "Lava strykewyrm"
      ],
      "beforePresent": false,
      "afterPresent": true,
      "after": {
        "Level": 94,
        "Weight": 12
      },
      "reason": "Match the existing assignment mapping and category-qualified prerequisite task; retain existing quest task identities."
    },
    {
      "path": [
        "slayerMasterTasks",
        "Kuradal",
        "Lava strykewyrms"
      ],
      "beforePresent": true,
      "before": {
        "Level": 94,
        "Weight": 12
      },
      "beforeRecordSha256": "289b14476eebaf1b8ffb0f3dc8983c65e233a206d06042e868069e15d1d52449",
      "afterPresent": false,
      "reason": "Remove the misspelled assignment key after preserving its requirements and weight."
    },
    {
      "path": [
        "slayerMasterTasks",
        "Kuradal",
        "Suqahs"
      ],
      "beforePresent": false,
      "afterPresent": true,
      "after": {
        "Tasks": {
          "~|Lunar Diplomacy|~ 6": "Quest"
        },
        "Weight": 5
      },
      "reason": "Match the existing assignment mapping and category-qualified prerequisite task; retain existing quest task identities."
    },
    {
      "path": [
        "slayerMasterTasks",
        "Kuradal",
        "Suqah"
      ],
      "beforePresent": true,
      "before": {
        "Tasks": {
          "~|Lunar Diplomacy|~ 6": "Quest"
        },
        "Weight": 5
      },
      "beforeRecordSha256": "9cf82105b47fcd96d6432e4bff60595200a891a739164922c567d35e52b3aefb",
      "afterPresent": false,
      "reason": "Remove the misspelled assignment key after preserving its requirements and weight."
    },
    {
      "path": [
        "slayerMasterTasks",
        "Morvran",
        "Lava strykewyrm"
      ],
      "beforePresent": false,
      "afterPresent": true,
      "after": {
        "Level": 94,
        "Weight": 8
      },
      "reason": "Match the existing assignment mapping and category-qualified prerequisite task; retain existing quest task identities."
    },
    {
      "path": [
        "slayerMasterTasks",
        "Morvran",
        "Lava strykewyrms"
      ],
      "beforePresent": true,
      "before": {
        "Level": 94,
        "Weight": 8
      },
      "beforeRecordSha256": "6410957831bb0343d0eeafd852b0a2788876401feb957474211843521681d87e",
      "afterPresent": false,
      "reason": "Remove the misspelled assignment key after preserving its requirements and weight."
    },
    {
      "path": [
        "slayerMasterTasks",
        "Morvran",
        "Soul devourers"
      ],
      "beforePresent": true,
      "before": {
        "Level": 105,
        "Tasks": {
          "~|Ichtlarin's Little Helper|~ 1": "Quest"
        },
        "Weight": 12
      },
      "beforeRecordSha256": "ff8169ea75a272b788baf4eecf96070d917259d4c98c60bd4b33bef9b989fbe9",
      "afterPresent": true,
      "after": {
        "Level": 105,
        "Tasks": {
          "~|Icthlarin's Little Helper|~ 1": "Quest"
        },
        "Weight": 12
      },
      "reason": "Match the existing assignment mapping and category-qualified prerequisite task; retain existing quest task identities."
    },
    {
      "path": [
        "slayerMasterTasks",
        "Laniakea",
        "Lava strykewyrm"
      ],
      "beforePresent": false,
      "afterPresent": true,
      "after": {
        "Level": 94,
        "Weight": 8
      },
      "reason": "Match the existing assignment mapping and category-qualified prerequisite task; retain existing quest task identities."
    },
    {
      "path": [
        "slayerMasterTasks",
        "Laniakea",
        "Lava strykewyrms"
      ],
      "beforePresent": true,
      "before": {
        "Level": 94,
        "Weight": 8
      },
      "beforeRecordSha256": "6410957831bb0343d0eeafd852b0a2788876401feb957474211843521681d87e",
      "afterPresent": false,
      "reason": "Remove the misspelled assignment key after preserving its requirements and weight."
    },
    {
      "path": [
        "slayerMasterTasks",
        "Mandrith",
        "Glacor"
      ],
      "beforePresent": false,
      "afterPresent": true,
      "after": {
        "Chunks": [
          "11837"
        ],
        "Weight": 5
      },
      "reason": "Match the existing assignment mapping and category-qualified prerequisite task; retain existing quest task identities."
    },
    {
      "path": [
        "slayerMasterTasks",
        "Mandrith",
        "Glacors"
      ],
      "beforePresent": true,
      "before": {
        "Chunks": [
          "11837"
        ],
        "Weight": 5
      },
      "beforeRecordSha256": "85bfa062bcd24bf74d5780a871263afe61266d5c432e4a70e76ad7c43b54a93a",
      "afterPresent": false,
      "reason": "Remove the misspelled assignment key after preserving its requirements and weight."
    },
    {
      "path": [
        "slayerMasterTasks",
        "Mandrith",
        "Lava strykewyrm"
      ],
      "beforePresent": false,
      "afterPresent": true,
      "after": {
        "Level": 94,
        "Chunks": [
          "12091"
        ],
        "Weight": 8
      },
      "reason": "Match the existing assignment mapping and category-qualified prerequisite task; retain existing quest task identities."
    },
    {
      "path": [
        "slayerMasterTasks",
        "Mandrith",
        "Lava strykewyrms"
      ],
      "beforePresent": true,
      "before": {
        "Level": 94,
        "Chunks": [
          "12091"
        ],
        "Weight": 8
      },
      "beforeRecordSha256": "2d5f4f6bb4973ccbdf77f6636b6d8b558f6bd31fe041416b9a44d2827d1b91d6",
      "afterPresent": false,
      "reason": "Remove the misspelled assignment key after preserving its requirements and weight."
    },
    {
      "path": [
        "codeItems",
        "reaperTasks",
        "General Graardor"
      ],
      "beforePresent": false,
      "afterPresent": true,
      "after": {
        "General Graardor": true,
        "General Graardor (Hard Mode)": true
      },
      "reason": "Match the existing master assignment and normal/hard-mode monster sources."
    },
    {
      "path": [
        "codeItems",
        "reaperTasks",
        "General Graador"
      ],
      "beforePresent": true,
      "before": {
        "General Graador": true,
        "General Graador (Hard Mode)": true
      },
      "beforeRecordSha256": "53ce262b7861f435d05d177797beb4439a4a83b7ee20b1943bafdd04a31791fb",
      "afterPresent": false,
      "reason": "Remove the misspelled mapping after preserving its canonical targets."
    },
    {
      "path": [
        "codeItems",
        "reaperTasks",
        "Black stone dragon"
      ],
      "beforePresent": true,
      "before": {
        "Black stone dragon": true
      },
      "beforeRecordSha256": "7aeaf50e50297010cf93cd74c7325ea33419edaa0b0a6552c24195d98d676b21",
      "afterPresent": true,
      "after": {
        "Black Stone Dragon": true
      },
      "reason": "Match the existing placed monster; preserve the master assignment label."
    },
    {
      "path": [
        "codeItems",
        "slayerTasks",
        "Birds"
      ],
      "beforePresent": true,
      "before": {
        "Pekin": true,
        "Undead pekin": true,
        "Duckling": true,
        "Duck": true,
        "Drake": true,
        "Chick (monster)": true,
        "Chicken": true,
        "Seagull": true,
        "Undead chicken": true,
        "Entranan firebird": true,
        "Chompy bird": true,
        "Rooster": true,
        "Bird": true,
        "Penguin": true,
        "Mounted terrorbird": true,
        "Terrorbird": true,
        "Jubbly bird": true,
        "Baby roc": true,
        "Pernicious parrot": true,
        "Evil chicken": true,
        "Tenacious tucan": true,
        "Oomlie bird": true
      },
      "beforeRecordSha256": "314b55d9fb9fc4fde2a092215cb1264a498518ee8d7b7ee09f81bcfe8752cbc0",
      "afterPresent": true,
      "after": {
        "Pekin": true,
        "Undead pekin": true,
        "Duckling": true,
        "Duck": true,
        "Drake": true,
        "Chick (monster)": true,
        "Chicken": true,
        "Seagull": true,
        "Undead chicken": true,
        "Entranan firebird": true,
        "Chompy bird": true,
        "Rooster": true,
        "Bird": true,
        "Penguin": true,
        "Mounted terrorbird": true,
        "Terrorbird": true,
        "Jubbly bird": true,
        "Baby roc": true,
        "Pernicious parrot": true,
        "Evil Chicken": true,
        "Tenacious tucan": true,
        "Oomlie bird": true
      },
      "reason": "Correct unique case-only monster identities against existing access sources; preserve unplaced special variants for review."
    },
    {
      "path": [
        "codeItems",
        "slayerTasks",
        "Black dragons"
      ],
      "beforePresent": true,
      "before": {
        "Baby black dragon": true,
        "Black dragon": true,
        "Verak Little": true,
        "Alanogard the Black": true,
        "King black dragon": true,
        "Queen black dragon": true,
        "Verak Lith": true
      },
      "beforeRecordSha256": "53a48c2663bd75d53cb0290a98f51013117ee09e675b6d4c2f84f974cda6f6d0",
      "afterPresent": true,
      "after": {
        "Baby black dragon": true,
        "Black dragon": true,
        "Verak Little": true,
        "Alanogard the Black": true,
        "King Black Dragon": true,
        "Queen Black Dragon": true,
        "Verak Lith": true
      },
      "reason": "Correct unique case-only monster identities against existing access sources; preserve unplaced special variants for review."
    },
    {
      "path": [
        "codeItems",
        "slayerTasks",
        "Demons"
      ],
      "beforePresent": true,
      "before": {
        "Imp (God Wars Dungeon)": true,
        "Imp": true,
        "Lesser demon": true,
        "Greater demon": true,
        "Gargoyle": true,
        "Abyssal demon": true,
        "Black demon": true,
        "K'ril Tsutsaroth": true,
        "Tstanon Karlak": true,
        "Balfrug Kreeyath": true,
        "Zakl'n gritch": true,
        "Abyssal savage": true,
        "Kal'gerion demon": true,
        "Abyssal beast": true,
        "Tormented demon": true,
        "Ripper Demon": true,
        "Abyssal lord": true,
        "Yol'Ger the Deceiver": true
      },
      "beforeRecordSha256": "396ada0158105b3b281f0a1baa5fff534473d6a987a3680e42f9ca3f9523b108",
      "afterPresent": true,
      "after": {
        "Imp (God Wars Dungeon)": true,
        "Imp": true,
        "Lesser demon": true,
        "Greater demon": true,
        "Gargoyle": true,
        "Abyssal demon": true,
        "Black demon": true,
        "K'ril Tsutsaroth": true,
        "Tstanon Karlak": true,
        "Balfrug Kreeyath": true,
        "Zakl'n Gritch": true,
        "Abyssal savage": true,
        "Kal'gerion demon": true,
        "Abyssal beast": true,
        "Tormented demon": true,
        "Ripper Demon": true,
        "Abyssal lord": true,
        "Yol'Ger the Deceiver": true
      },
      "reason": "Correct unique case-only monster identities against existing access sources; preserve unplaced special variants for review."
    },
    {
      "path": [
        "codeItems",
        "slayerTasks",
        "Dragons"
      ],
      "beforePresent": true,
      "before": {
        "Adamant dragon": true,
        "Alanogard the Black": true,
        "Astellarn": true,
        "Baby blue dragon": true,
        "Baby red dragon": true,
        "Black dragon": true,
        "Black dragon (Dragonkin Laboratory)": true,
        "Black stone dragon": true,
        "Blue dragon": true,
        "Bronze dragon": true,
        "Brutal green dragon": true,
        "Celestial dragon": true,
        "Celestial dragon (Dragonkin Laboratory)": true,
        "Dragonstone dragon": true,
        "Dragonstone dragon (Dragonkin Laboratory)": true,
        "Elegorn the Celestial": true,
        "Frost dragon": true,
        "Green dragon": true,
        "Hydrix dragon": true,
        "Hydrix dragon (Dragonkin Laboratory)": true,
        "Iron dragon": true,
        "King Black Dragon": true,
        "Mithril dragon": true,
        "Nodon artificer": true,
        "Nodon engineer": true,
        "Nodon guard": true,
        "Nodon hunter": true,
        "Onyx dragon": true,
        "Onyx dragon (Dragonkin Laboratory)": true,
        "Queen Black Dragon": true,
        "Red dragon": true,
        "Red dragon (Dragonkin Laboratory)": true,
        "Revenant dragon": true,
        "Rune dragon": true,
        "Sangri the Red": true,
        "Siege engine": true,
        "Steel dragon": true,
        "Verak Lith": true,
        "Verak Little": true,
        "Vorkath": true
      },
      "beforeRecordSha256": "af6e4398041eea7c7c895176ab23ca71c9790d427bd4d7896353961159fb536a",
      "afterPresent": true,
      "after": {
        "Adamant dragon": true,
        "Alanogard the Black": true,
        "Astellarn": true,
        "Baby blue dragon": true,
        "Baby red dragon": true,
        "Black dragon": true,
        "Black dragon (Dragonkin Laboratory)": true,
        "Black Stone Dragon": true,
        "Blue dragon": true,
        "Bronze dragon": true,
        "Brutal green dragon": true,
        "Celestial dragon": true,
        "Celestial dragon (Dragonkin Laboratory)": true,
        "Dragonstone dragon": true,
        "Dragonstone dragon (Dragonkin Laboratory)": true,
        "Elegorn the Celestial": true,
        "Frost dragon": true,
        "Green dragon": true,
        "Hydrix dragon": true,
        "Hydrix dragon (Dragonkin Laboratory)": true,
        "Iron dragon": true,
        "King Black Dragon": true,
        "Mithril dragon": true,
        "Nodon artificer": true,
        "Nodon engineer": true,
        "Nodon guard": true,
        "Nodon hunter": true,
        "Onyx dragon": true,
        "Onyx dragon (Dragonkin Laboratory)": true,
        "Queen Black Dragon": true,
        "Red dragon": true,
        "Red dragon (Dragonkin Laboratory)": true,
        "Revenant dragon": true,
        "Rune dragon": true,
        "Sangri the Red": true,
        "Siege engine": true,
        "Steel dragon": true,
        "Verak Lith": true,
        "Verak Little": true,
        "Vorkath": true
      },
      "reason": "Correct unique case-only monster identities against existing access sources; preserve unplaced special variants for review."
    },
    {
      "path": [
        "codeItems",
        "slayerTasks",
        "Gemstone dragons"
      ],
      "beforePresent": true,
      "before": {
        "Dragonstone dragon (Dragonkin Laboratory)": true,
        "Onyx dragon (Dragonkin Laboratory)": true,
        "Hydrix dragon (Dragonkin Laboratory)": true,
        "Dragonstone dragon": true,
        "Onyx dragon": true,
        "Hydrix dragon": true,
        "Black stone dragon": true
      },
      "beforeRecordSha256": "4018e84741d7cb81b5325093ad31503325c6d33efba82658b4560d09bd7915fe",
      "afterPresent": true,
      "after": {
        "Dragonstone dragon (Dragonkin Laboratory)": true,
        "Onyx dragon (Dragonkin Laboratory)": true,
        "Hydrix dragon (Dragonkin Laboratory)": true,
        "Dragonstone dragon": true,
        "Onyx dragon": true,
        "Hydrix dragon": true,
        "Black Stone Dragon": true
      },
      "reason": "Correct unique case-only monster identities against existing access sources; preserve unplaced special variants for review."
    },
    {
      "path": [
        "codeItems",
        "slayerTasks",
        "Ghosts"
      ],
      "beforePresent": true,
      "before": {
        "Aberrant spectre": true,
        "Ankou": true,
        "Ghost (Melzar's maze)": true,
        "Ghost (Spirit of Summer)": true,
        "Revenant imp": true,
        "Revenant goblin": true,
        "Ghost": true,
        "Revenant icefiend": true,
        "Revenant pyrefiend": true,
        "Revenant hobgoblin": true,
        "Revenant vampyre": true,
        "Tortured soul (Port Phasmatys)": true,
        "Revenant werewolf": true,
        "Revenant cyclops": true,
        "Ghostly warrior": true,
        "Ghostly troll thrower": true,
        "Ghostly troll bruiser": true,
        "Revenant hellhound": true,
        "Spectral tender": true,
        "Spectral cultivator": true,
        "Spectral worshipper": true,
        "Spectral attendant": true,
        "Revenant demon": true,
        "Revenant ork": true,
        "Revenant dark beast": true,
        "Revenant knight": true,
        "Revenant dragon": true,
        "Banshee": true,
        "Banshee mistress": true,
        "Edimmu": true,
        "Risen ghost": true,
        "Ahrim the Blighted": true,
        "Akrisae the Doomed": true,
        "Asyn shade": true,
        "Dharok the Wretched": true,
        "Fiyr shade": true,
        "Ghast": true,
        "Guthan the Infested": true,
        "Tormented soul (Uncharted Isles)": true,
        "Tormented wraith": true,
        "Shadow warrior": true,
        "Masuta the Descended": true,
        "Karil the Tainted": true,
        "Torag the Corrupted": true,
        "Linza the Disgraced": true,
        "Loar Shade": true,
        "Mighty banshee": true,
        "Phrin shade": true,
        "Riyl shade": true,
        "Shade": true,
        "Spiritual mage": true,
        "Spiritual ranger": true,
        "Spiritual warrior": true,
        "Verac the Defiled": true,
        "Wight": true,
        "Wight ranger": true
      },
      "beforeRecordSha256": "e761f6b8bd1fe5fca565a4a7e37244b0b977e5ada937ea2d869ab337b7fded35",
      "afterPresent": true,
      "after": {
        "Aberrant spectre": true,
        "Ankou": true,
        "Ghost (Melzar's Maze)": true,
        "Ghost (Spirit of Summer)": true,
        "Revenant imp": true,
        "Revenant goblin": true,
        "Ghost": true,
        "Revenant icefiend": true,
        "Revenant pyrefiend": true,
        "Revenant hobgoblin": true,
        "Revenant vampyre": true,
        "Tortured soul (Port Phasmatys)": true,
        "Revenant werewolf": true,
        "Revenant cyclops": true,
        "Ghostly warrior": true,
        "Ghostly troll thrower": true,
        "Ghostly troll bruiser": true,
        "Revenant hellhound": true,
        "Spectral tender": true,
        "Spectral cultivator": true,
        "Spectral worshipper": true,
        "Spectral attendant": true,
        "Revenant demon": true,
        "Revenant ork": true,
        "Revenant dark beast": true,
        "Revenant knight": true,
        "Revenant dragon": true,
        "Banshee": true,
        "Banshee mistress": true,
        "Edimmu": true,
        "Risen ghost": true,
        "Ahrim the Blighted": true,
        "Akrisae the Doomed": true,
        "Asyn Shade": true,
        "Dharok the Wretched": true,
        "Fiyr Shade": true,
        "Ghast": true,
        "Guthan the Infested": true,
        "Tormented soul (Uncharted Isles)": true,
        "Tormented wraith": true,
        "Shadow warrior": true,
        "Masuta the Descended": true,
        "Karil the Tainted": true,
        "Torag the Corrupted": true,
        "Linza the Disgraced": true,
        "Loar Shade": true,
        "Mighty banshee": true,
        "Phrin Shade": true,
        "Riyl Shade": true,
        "Shade": true,
        "Spiritual mage": true,
        "Spiritual ranger": true,
        "Spiritual warrior": true,
        "Verac the Defiled": true,
        "Wight": true,
        "Wight ranger": true
      },
      "reason": "Correct unique case-only monster identities against existing access sources; preserve unplaced special variants for review."
    },
    {
      "path": [
        "codeItems",
        "slayerTasks",
        "Greater demons"
      ],
      "beforePresent": true,
      "before": {
        "Butcher demon": true,
        "Champion of Infernus": true,
        "Chaos Demon": true,
        "Chaos Demon Savage": true,
        "Denizen of Infernus": true,
        "Greater demon": true,
        "Greater demon (elite)": true,
        "Greater demon ash lord": true,
        "Greater demon brute": true,
        "Greater demon pyromancer": true,
        "Greater demon sage": true,
        "Greater demon savage": true,
        "K'ril Tsutsaroth": true,
        "Kor'Vath the Blightbringer": true,
        "La'Kalor the Unbroken": true,
        "Shara'Kor the Widowmaker": true,
        "Tstanon Karlak": true
      },
      "beforeRecordSha256": "b22769ba0607190b47f70ae298baa84f00d20c1ea56ff119951223b4b13e7e2f",
      "afterPresent": true,
      "after": {
        "Butcher demon": true,
        "Champion of Infernus": true,
        "Chaos demon": true,
        "Chaos demon savage": true,
        "Denizen of Infernus": true,
        "Greater demon": true,
        "Greater demon (elite)": true,
        "Greater demon ash lord": true,
        "Greater demon brute": true,
        "Greater demon pyromancer": true,
        "Greater demon sage": true,
        "Greater demon savage": true,
        "K'ril Tsutsaroth": true,
        "Kor'Vath the Blightbringer": true,
        "La'Kalor the Unbroken": true,
        "Shara'Kor the Widowmaker": true,
        "Tstanon Karlak": true
      },
      "reason": "Correct unique case-only monster identities against existing access sources; preserve unplaced special variants for review."
    },
    {
      "path": [
        "codeItems",
        "slayerTasks",
        "Kalphites"
      ],
      "beforePresent": true,
      "before": {
        "Kalphite worker": true,
        "Kalphite soldier": true,
        "Kalphite guardian": true,
        "Exiled kalphite worker": true,
        "Exiled kalphite paragon": true,
        "Exiled kalphite soldier": true,
        "Exiled kalphite marauder": true,
        "Exiled kalphite guardian": true,
        "Corrupted kalphite guardian": true,
        "Corrupted kalphite marauder": true,
        "Kalphite Queen": true,
        "Exiled kalphite queen": true,
        "Kalphite king": true
      },
      "beforeRecordSha256": "7b92126393eef611c7400470361ecb1b4db31f4a8b060173375827553e8a1e35",
      "afterPresent": true,
      "after": {
        "Kalphite Worker": true,
        "Kalphite Soldier": true,
        "Kalphite Guardian": true,
        "Exiled kalphite worker": true,
        "Exiled kalphite paragon": true,
        "Exiled kalphite soldier": true,
        "Exiled kalphite marauder": true,
        "Exiled kalphite guardian": true,
        "Corrupted kalphite guardian": true,
        "Corrupted kalphite marauder": true,
        "Kalphite Queen": true,
        "Exiled Kalphite Queen": true,
        "Kalphite King": true
      },
      "reason": "Correct unique case-only monster identities against existing access sources; preserve unplaced special variants for review."
    },
    {
      "path": [
        "codeItems",
        "slayerTasks",
        "Scorpions"
      ],
      "beforePresent": true,
      "before": {
        "Grave scorpion": true,
        "Scorpion": true,
        "Scorpion (Ape Atoll)": true,
        "King scorpion": true,
        "Giant lobster": true,
        "Giant lobster (Ghosts ahoy)": true,
        "Poison scorpion": true,
        "Pit scorpion": true,
        "Corrupted scorpion": true
      },
      "beforeRecordSha256": "d9086fd8d8c0534da76ce0089b811add264e8558f428448a550c120dbb261287",
      "afterPresent": true,
      "after": {
        "Grave scorpion": true,
        "Scorpion": true,
        "Scorpion (Ape Atoll)": true,
        "King Scorpion": true,
        "Giant Lobster": true,
        "Giant lobster (Ghosts ahoy)": true,
        "Poison Scorpion": true,
        "Pit Scorpion": true,
        "Corrupted scorpion": true
      },
      "reason": "Correct unique case-only monster identities against existing access sources; preserve unplaced special variants for review."
    },
    {
      "path": [
        "codeItems",
        "slayerTasks",
        "Skeletons"
      ],
      "beforePresent": true,
      "before": {
        "Skeleton warrior": true,
        "Skeleton Mage": true,
        "Skeleton Mage (Piscatoris Fihsing Colony)": true,
        "Skeleton (demon slayer)": true,
        "Fabricated skeleton archer": true,
        "Fabricated giant skeleton": true,
        "Skeleton warlock": true,
        "Skeleton#Armed": true,
        "Skeleton#Unarmed": true,
        "Skeleton (Lumbridge Catacombs)": true,
        "Skeleton (Draynor Manor)": true,
        "Skeleton (Melzar's maze)": true,
        "Skoblin": true,
        "Snothead": true,
        "Skeleton fremennik": true,
        "Snailfeet": true,
        "Mosschin": true,
        "Redeyes": true,
        "Strongbones": true,
        "Undead one (skeleton)": true,
        "Skeleton (Tarn's lair)#High Level": true,
        "Skeleton (Tarn's lair)#Mid Level": true,
        "Skeleton (Tarn's lair)#Low Level": true,
        "Skeletal miner": true,
        "Ulfric": true,
        "Skeleton archer": true,
        "Skogre": true,
        "Skeletal hand": true,
        "skeleton hero": true,
        "Skeleton (Ape Atoll)": true,
        "Giant skeleton (Tarn's lair)": true,
        "Giant skeleton (Shadow dungeon)": true,
        "Skeleton thug": true,
        "Skeleton brute": true,
        "Skeleton heavy": true,
        "Skeleton warlord": true,
        "Skeleton (HoG)": true,
        "Huge skeleton": true,
        "Bossy McBossFace's First mate": true,
        "Skeletal Wyvern": true,
        "Bound skeleton": true
      },
      "beforeRecordSha256": "d03271d3d3c0bffe24733cb0cd8359983a11fa243d2dc703decda972a917d29a",
      "afterPresent": true,
      "after": {
        "Skeleton warrior": true,
        "Skeleton Mage": true,
        "Skeleton Mage (Piscatoris Fihsing Colony)": true,
        "Skeleton (demon slayer)": true,
        "Fabricated skeleton archer": true,
        "Fabricated giant skeleton": true,
        "Skeleton warlock": true,
        "Skeleton#Armed": true,
        "Skeleton#Unarmed": true,
        "Skeleton (Lumbridge Catacombs)": true,
        "Skeleton (Draynor Manor)": true,
        "Skeleton (Melzar's Maze)": true,
        "Skoblin": true,
        "Snothead": true,
        "Skeleton fremennik": true,
        "Snailfeet": true,
        "Mosschin": true,
        "Redeyes": true,
        "Strongbones": true,
        "Undead one (skeleton)": true,
        "Skeleton (Tarn's Lair)#High Level": true,
        "Skeleton (Tarn's Lair)#Mid Level": true,
        "Skeleton (Tarn's Lair)#Low Level": true,
        "Skeletal miner": true,
        "Ulfric": true,
        "Skeleton archer": true,
        "Skogre": true,
        "Skeletal hand": true,
        "skeleton hero": true,
        "Skeleton (Ape Atoll)": true,
        "Giant skeleton (Tarn's Lair)": true,
        "Giant skeleton (Shadow Dungeon)": true,
        "Skeleton thug": true,
        "Skeleton brute": true,
        "Skeleton heavy": true,
        "Skeleton warlord": true,
        "Skeleton (HoG)": true,
        "Huge skeleton": true,
        "Bossy McBossFace's First mate": true,
        "Skeletal Wyvern": true,
        "Bound skeleton": true
      },
      "reason": "Correct unique case-only monster identities against existing access sources; preserve unplaced special variants for review."
    },
    {
      "path": [
        "codeItems",
        "slayerTasks",
        "Trolls"
      ],
      "beforePresent": true,
      "before": {
        "River troll": true,
        "Troll runt": true,
        "Unnatural big troll": true,
        "Troll chucker": true,
        "Troll shaman": true,
        "Troll brute": true,
        "The map": true,
        "Troll commando": true,
        "Mountain troll (well)": true,
        "Mountain troll": true,
        "Troll spectator": true,
        "Ice troll grunt#Variant 1": true,
        "Ice troll grunt#Variant 2": true,
        "Ice troll runt#Variant 1": true,
        "Ice troll runt#Variant 2": true,
        "Ice troll runt#Variant 3": true,
        "Ice troll female#Variant 1": true,
        "Ice troll female#Variant 2": true,
        "Ice troll female#Variant 3": true,
        "Ice troll male#Variant 1": true,
        "Ice troll male#Variant 2": true,
        "Ice troll male#Variant 3": true,
        "Twig": true,
        "Berry": true,
        "Arrg": true,
        "Thrower troll": true,
        "Dad": true,
        "Kraka": true,
        "Pee Hat": true,
        "Ice troll": true,
        "Ice troll King": true,
        "Troll general": true
      },
      "beforeRecordSha256": "0a593f870266cb827e35cdf0e63e7c543af976379834c641418e8d0e778dcfb0",
      "afterPresent": true,
      "after": {
        "River troll": true,
        "Troll runt": true,
        "Unnatural big troll": true,
        "Troll chucker": true,
        "Troll shaman": true,
        "Troll brute": true,
        "The map": true,
        "Troll commando": true,
        "Mountain troll (well)": true,
        "Mountain troll": true,
        "Troll spectator": true,
        "Ice troll grunt#Variant 1": true,
        "Ice troll grunt#Variant 2": true,
        "Ice troll runt#Variant 1": true,
        "Ice troll runt#Variant 2": true,
        "Ice troll runt#Variant 3": true,
        "Ice troll female#Variant 1": true,
        "Ice troll female#Variant 2": true,
        "Ice troll female#Variant 3": true,
        "Ice troll male#Variant 1": true,
        "Ice troll male#Variant 2": true,
        "Ice troll male#Variant 3": true,
        "Twig": true,
        "Berry": true,
        "Arrg": true,
        "Thrower Troll": true,
        "Dad": true,
        "Kraka": true,
        "Pee Hat": true,
        "Ice troll": true,
        "Ice troll King": true,
        "Troll general": true
      },
      "reason": "Correct unique case-only monster identities against existing access sources; preserve unplaced special variants for review."
    },
    {
      "path": [
        "codeItems",
        "slayerTasks",
        "Undead"
      ],
      "beforePresent": true,
      "before": {
        "Aberrant spectre": true,
        "Ahrim the Blighted": true,
        "Akrisae the Doomed": true,
        "Animated book (Dimension of Disaster)": true,
        "Animated spade": true,
        "Ankou": true,
        "Armoured zombie": true,
        "Asyn shade": true,
        "Banshee": true,
        "Banshee mistress": true,
        "Bound skeleton": true,
        "Corpse archer": true,
        "Corpse mage": true,
        "Crawling hand": true,
        "Death wing": true,
        "Dharok the Wretched": true,
        "Dragith Nurn": true,
        "Edimmu": true,
        "Fetid zombie": true,
        "Fiyr shade": true,
        "Ghast": true,
        "Ghost": true,
        "Ghost (Melzar's maze)": true,
        "Graveside phantom": true,
        "Guthan the Infested": true,
        "Karil the Tainted": true,
        "Linza the Disgraced": true,
        "Loar shade": true,
        "Magic axe": true,
        "Mighty banshee": true,
        "Monkey zombie": true,
        "Mummy": true,
        "Mummy (Jaldraocht Pyramid)": true,
        "Mummy (Sophanem)": true,
        "Mummy (Ullek)": true,
        "Mummy warrior": true,
        "Phrin shade": true,
        "Possessed pickaxe": true,
        "Possessed pickaxe (Lava Flow Mine)": true,
        "Revenant imp": true,
        "Revenant goblin": true,
        "Revenant icefiend": true,
        "Revenant pyrefiend": true,
        "Revenant hobgoblin": true,
        "Revenant vampyre": true,
        "Revenant werewolf": true,
        "Revenant cyclops": true,
        "Revenant hellhound": true,
        "Revenant demon": true,
        "Revenant ork": true,
        "Revenant dark beast": true,
        "Revenant knight": true,
        "Revenant dragon": true,
        "Risen ghost": true,
        "Riyl shade": true,
        "Shade": true,
        "Skeletal Wyvern": true,
        "Skeleton mage": true,
        "Skeleton": true,
        "Skeleton (Tarn's Lair)#Low Level": true,
        "Skeleton (Tarn's Lair)#Mid Level": true,
        "Skeleton (Tarn's Lair)#High Level": true,
        "Skoblin": true,
        "Skogre": true,
        "Small scarab": true,
        "Soulless": true,
        "Spiritual mage": true,
        "Spiritual ranger": true,
        "Spiritual warrior": true,
        "Verac the Defiled": true,
        "Wight": true,
        "Wight ranger": true,
        "Zombie pirate": true,
        "Zombie swab": true,
        "Zombie (Lair of Tarn Razorlor)#Low Level": true,
        "Zombie (Lair of Tarn Razorlor)#Mid Level": true,
        "Zombie (Lair of Tarn Razorlor)#High Level": true,
        "Zombie#Level 12": true,
        "Zombie#Level 22": true,
        "Zombie#Level 29": true
      },
      "beforeRecordSha256": "54d93b2b0753366fdb1dbf86a6feabc66a86bbcc8547872b5551a57029b8456c",
      "afterPresent": true,
      "after": {
        "Aberrant spectre": true,
        "Ahrim the Blighted": true,
        "Akrisae the Doomed": true,
        "Animated book (Dimension of Disaster)": true,
        "Animated spade": true,
        "Ankou": true,
        "Armoured zombie": true,
        "Asyn Shade": true,
        "Banshee": true,
        "Banshee mistress": true,
        "Bound skeleton": true,
        "Corpse archer": true,
        "Corpse mage": true,
        "Crawling hand": true,
        "Death wing": true,
        "Dharok the Wretched": true,
        "Dragith Nurn": true,
        "Edimmu": true,
        "Fetid zombie": true,
        "Fiyr Shade": true,
        "Ghast": true,
        "Ghost": true,
        "Ghost (Melzar's Maze)": true,
        "Graveside phantom": true,
        "Guthan the Infested": true,
        "Karil the Tainted": true,
        "Linza the Disgraced": true,
        "Loar Shade": true,
        "Magic axe": true,
        "Mighty banshee": true,
        "Monkey Zombie": true,
        "Mummy": true,
        "Mummy (Jaldraocht Pyramid)": true,
        "Mummy (Sophanem)": true,
        "Mummy (Ullek)": true,
        "Mummy warrior": true,
        "Phrin Shade": true,
        "Possessed pickaxe": true,
        "Possessed pickaxe (Lava Flow Mine)": true,
        "Revenant imp": true,
        "Revenant goblin": true,
        "Revenant icefiend": true,
        "Revenant pyrefiend": true,
        "Revenant hobgoblin": true,
        "Revenant vampyre": true,
        "Revenant werewolf": true,
        "Revenant cyclops": true,
        "Revenant hellhound": true,
        "Revenant demon": true,
        "Revenant ork": true,
        "Revenant dark beast": true,
        "Revenant knight": true,
        "Revenant dragon": true,
        "Risen ghost": true,
        "Riyl Shade": true,
        "Shade": true,
        "Skeletal Wyvern": true,
        "Skeleton Mage": true,
        "Skeleton": true,
        "Skeleton (Tarn's Lair)#Low Level": true,
        "Skeleton (Tarn's Lair)#Mid Level": true,
        "Skeleton (Tarn's Lair)#High Level": true,
        "Skoblin": true,
        "Skogre": true,
        "Small scarab": true,
        "Soulless": true,
        "Spiritual mage": true,
        "Spiritual ranger": true,
        "Spiritual warrior": true,
        "Verac the Defiled": true,
        "Wight": true,
        "Wight ranger": true,
        "Zombie pirate": true,
        "Zombie swab": true,
        "Zombie (Lair of Tarn Razorlor)#Low Level": true,
        "Zombie (Lair of Tarn Razorlor)#Mid Level": true,
        "Zombie (Lair of Tarn Razorlor)#High Level": true,
        "Zombie#Level 12": true,
        "Zombie#Level 22": true,
        "Zombie#Level 29": true
      },
      "reason": "Correct unique case-only monster identities against existing access sources; preserve unplaced special variants for review."
    },
    {
      "path": [
        "codeItems",
        "slayerTasks",
        "Vampyres"
      ],
      "beforePresent": true,
      "before": {
        "Revenant vampyre": true,
        "Vampyre juvenile": true,
        "Angry vampyre": true,
        "Vampyre juvinate": true,
        "Feral vampyre": true,
        "Dessous": true,
        "Vampyre": true
      },
      "beforeRecordSha256": "b23bc6a6df4d21109cd75a4fd0fa8d72c50a9c1e70467719aae2362a37e26662",
      "afterPresent": true,
      "after": {
        "Revenant vampyre": true,
        "Vampyre Juvenile": true,
        "Angry vampyre": true,
        "Vampyre Juvinate": true,
        "Feral vampyre": true,
        "Dessous": true,
        "Vampyre": true
      },
      "reason": "Correct unique case-only monster identities against existing access sources; preserve unplaced special variants for review."
    },
    {
      "path": [
        "codeItems",
        "slayerTasks",
        "Waterfiend"
      ],
      "beforePresent": true,
      "before": {
        "Waterfiend (Ghorrock)": true,
        "Waterfiend (Temple of aminishi)": true,
        "Waterfiend": true
      },
      "beforeRecordSha256": "6b4843a9869432e01486fb26e25c4d04e3f9a2717bc69a8d91c98ca7a4044ade",
      "afterPresent": true,
      "after": {
        "Waterfiend (Ghorrock)": true,
        "Waterfiend (Temple of Aminishi)": true,
        "Waterfiend": true
      },
      "reason": "Correct unique case-only monster identities against existing access sources; preserve unplaced special variants for review."
    },
    {
      "path": [
        "codeItems",
        "slayerTasks",
        "Wolves"
      ],
      "beforePresent": true,
      "before": {
        "White wolf (Burthorpe)": true,
        "Adolescent White wolf": true,
        "Desert wolf": true,
        "Wolf": true,
        "Wolf (Havenhythe)": true,
        "White wolf": true,
        "Fenris wolf": true,
        "Big wolf": true,
        "Dire wolf": true,
        "Ice wolf": true,
        "Jungle wolf": true
      },
      "beforeRecordSha256": "555aee4775d46abb03bd747803383877cfcdd17e380acc4286d162829cc57efa",
      "afterPresent": true,
      "after": {
        "White wolf (Burthorpe)": true,
        "Adolescent White wolf": true,
        "Desert wolf": true,
        "Wolf": true,
        "Wolf (Havenhythe)": true,
        "White wolf": true,
        "Fenris wolf": true,
        "Big Wolf": true,
        "Dire Wolf": true,
        "Ice wolf": true,
        "Jungle Wolf": true
      },
      "reason": "Correct unique case-only monster identities against existing access sources; preserve unplaced special variants for review."
    },
    {
      "path": [
        "codeItems",
        "slayerTasks",
        "Zombies"
      ],
      "beforePresent": true,
      "before": {
        "Fetid zombie": true,
        "Black knight zombie": true,
        "Zombie cow": true,
        "Undead chicken": true,
        "Zombie rat": true,
        "Corpse spider": true,
        "Undead cow": true,
        "Crawling corpse torse": true,
        "Zombie#Level 12": true,
        "Zombie#Level 22": true,
        "Zombie#Level 29": true,
        "Summoned zombie": true,
        "Corpse archer": true,
        "Corpse mage": true,
        "Zombie pirate": true,
        "Zombie (zogre flesh eaters)": true,
        "Armoured zombie": true,
        "Zombie swab": true,
        "Sorebones": true,
        "Undead lumberjack": true,
        "Zogre": true,
        "Dried zombie": true,
        "Monkey zombie": true,
        "Zombie (Lair of Tarn Razorlor)#Low Level": true,
        "Zombie (Lair of Tarn Razorlor)#Mid Level": true,
        "Zombie (Lair of Tarn Razorlor)#High Level": true,
        "Zombie hand": true,
        "Undead troll": true,
        "General malpractioner": true,
        "Ulthven Keith": true,
        "Bossy McBossFace": true,
        "Undead witch": true,
        "Edimmu": true,
        "Small scarab": true
      },
      "beforeRecordSha256": "72cbf93af42fe3165ad22cf4497d9efdf4dedf70fca71860c5c83b63ce1d4e6b",
      "afterPresent": true,
      "after": {
        "Fetid zombie": true,
        "Black knight zombie": true,
        "Zombie cow": true,
        "Undead chicken": true,
        "Zombie rat": true,
        "Corpse spider": true,
        "Undead cow": true,
        "Crawling corpse torse": true,
        "Zombie#Level 12": true,
        "Zombie#Level 22": true,
        "Zombie#Level 29": true,
        "Summoned zombie": true,
        "Corpse archer": true,
        "Corpse mage": true,
        "Zombie pirate": true,
        "Zombie (zogre flesh eaters)": true,
        "Armoured zombie": true,
        "Zombie swab": true,
        "Sorebones": true,
        "Undead Lumberjack": true,
        "Zogre": true,
        "Dried zombie": true,
        "Monkey Zombie": true,
        "Zombie (Lair of Tarn Razorlor)#Low Level": true,
        "Zombie (Lair of Tarn Razorlor)#Mid Level": true,
        "Zombie (Lair of Tarn Razorlor)#High Level": true,
        "Zombie hand": true,
        "Undead troll": true,
        "General malpractioner": true,
        "Ulthven Keith": true,
        "Bossy McBossFace": true,
        "Undead witch": true,
        "Edimmu": true,
        "Small scarab": true
      },
      "reason": "Correct unique case-only monster identities against existing access sources; preserve unplaced special variants for review."
    },
    {
      "path": [
        "codeItems",
        "reaperTasks",
        "Corporeal Beast"
      ],
      "beforePresent": false,
      "afterPresent": true,
      "after": {
        "Corporeal Beast": true
      },
      "reason": "Resolve the assignment to its existing base monster. Special variants remain subject to separate review."
    },
    {
      "path": [
        "codeItems",
        "slayerTasks",
        "Onyx dragons"
      ],
      "beforePresent": false,
      "afterPresent": true,
      "after": {
        "Onyx dragon": true
      },
      "reason": "Resolve the assignment to its existing base monster. Special variants remain subject to separate review."
    },
    {
      "path": [
        "codeItems",
        "slayerTasks",
        "Soulgazers"
      ],
      "beforePresent": false,
      "afterPresent": true,
      "after": {
        "Soulgazer": true
      },
      "reason": "Resolve the assignment to its existing base monster. Special variants remain subject to separate review."
    },
    {
      "path": [
        "slayerMasterTasks",
        "Mazchna/Achtryn",
        "Sanguine crawlers",
        "Weight"
      ],
      "beforePresent": true,
      "before": 10,
      "beforeRecordSha256": "4a44dc15364204a80fe80e9039455cc1608281820fe2b24f1e5233ade6af1dd5",
      "afterPresent": true,
      "after": 15,
      "reason": "Match the assignment weight in the reviewed RS Wiki master table (2026-10-31).",
      "wiki": {
        "url": "https://runescape.wiki/w/Slayer_assignment/Mazchna",
        "source": "Sanguine crawlers assignment weight 15."
      }
    },
    {
      "path": [
        "slayerMasterTasks",
        "Sumona",
        "Profane Scabarites",
        "Weight"
      ],
      "beforePresent": true,
      "before": 5,
      "beforeRecordSha256": "ef2d127de37b942baad06145e54b0c619a1f22327b2ebbcfbec78f5564afe39d",
      "afterPresent": true,
      "after": 15,
      "reason": "Match the assignment weight in the reviewed RS Wiki master table (2026-10-31).",
      "wiki": {
        "url": "https://runescape.wiki/w/Slayer_assignment/Sumona",
        "source": "Profane Scabarites assignment weight 15."
      }
    },
    {
      "path": [
        "slayerMasterTasks",
        "Kuradal",
        "Profane Scabarites",
        "Weight"
      ],
      "beforePresent": true,
      "before": 5,
      "beforeRecordSha256": "ef2d127de37b942baad06145e54b0c619a1f22327b2ebbcfbec78f5564afe39d",
      "afterPresent": true,
      "after": 10,
      "reason": "Match the assignment weight in the reviewed RS Wiki master table (2026-10-31).",
      "wiki": {
        "url": "https://runescape.wiki/w/Slayer_assignment/Kuradal",
        "source": "Profane Scabarites assignment weight 10."
      }
    },
    {
      "path": [
        "slayerMasterTasks",
        "Morvran",
        "Profane Scabarites",
        "Weight"
      ],
      "beforePresent": true,
      "before": 5,
      "beforeRecordSha256": "ef2d127de37b942baad06145e54b0c619a1f22327b2ebbcfbec78f5564afe39d",
      "afterPresent": true,
      "after": 12,
      "reason": "Match the assignment weight in the reviewed RS Wiki master table (2026-10-31).",
      "wiki": {
        "url": "https://runescape.wiki/w/Slayer_assignment/Morvran",
        "source": "Profane Scabarites assignment weight 12."
      }
    },
    {
      "path": [
        "slayerMasterTasks",
        "Laniakea",
        "Profane Scabarites",
        "Weight"
      ],
      "beforePresent": true,
      "before": 5,
      "beforeRecordSha256": "ef2d127de37b942baad06145e54b0c619a1f22327b2ebbcfbec78f5564afe39d",
      "afterPresent": true,
      "after": 12,
      "reason": "Match the assignment weight in the reviewed RS Wiki master table (2026-10-31).",
      "wiki": {
        "url": "https://runescape.wiki/w/Slayer_assignment/Laniakea",
        "source": "Profane Scabarites assignment weight 12."
      }
    },
    {
      "path": [
        "slayerMasterTasks",
        "Laniakea",
        "Undead",
        "Weight"
      ],
      "beforePresent": true,
      "before": 9,
      "beforeRecordSha256": "19581e27de7ced00ff1ce50b2047e7a567c76b1cbaebabe5ef03f7c3017bb5b7",
      "afterPresent": true,
      "after": 4,
      "reason": "Match the assignment weight in the reviewed RS Wiki master table (2026-10-31).",
      "wiki": {
        "url": "https://runescape.wiki/w/Slayer_assignment/Laniakea",
        "source": "Undead assignment weight 4."
      }
    },
    {
      "path": [
        "challenges",
        "Diary",
        "~|Ardougne Achievements#Hard|~ Complete the Hard Achievements",
        "Tasks"
      ],
      "beforePresent": true,
      "before": {
        "~|Ardougne Achievements#Medium|~ Complete the Medium Achievements": "Diary",
        "~|Ardougne Achievements#Hard|~ Blood Bank Withdrawal": "Diary",
        "~|Ardougne Achievements#Hard|~ A Taste of the Exotic": "Diary",
        "~|Ardougne Achievements#Hard|~ It's My Newt": "Diary",
        "~|Ardougne Achievements#Hard|~ Monkey Business": "Diary",
        "~|Ardougne Achievements#Hard|~ Who Wants to Watch the Watchtower?": "Diary",
        "~|Ardougne Achievements#Hard|~ Living on a Prayer": "Diary",
        "~|Ardougne Achievements#Hard|~ Vine-detta": "Diary",
        "~|Ardougne Achievements#Hard|~ Get Your Stinking Hands Off Me": "Diary",
        "~|Ardougne Achievements#Hard|~ It Just Croaked": "Diary",
        "~|Ardougne Achievements#Hard|~ Not on My Watch": "Diary",
        "~|Ardougne Achievements#Hard|~ Ourania Mania": "Diary",
        "~|Ardougne Achievements#Hard|~ You're the Dirty Rascal": "Diary",
        "~|Ardougne Achievements#Hard|~ Nice View": "Diary",
        "~|Ardougne Achievements#Hard|~ Just Like That": "Diary",
        "~|Ardougne Achievements#Hard|~ Shadow Boxing": "Diary",
        "~|Ardougne Achievements#Hard|~ Brace Yourself": "Diary"
      },
      "beforeRecordSha256": "81c5034998254d3b93db352d58251d56f4c9359fc7396756ab3024eaefdbf59f",
      "afterPresent": true,
      "after": {
        "~|Ardougne Achievements#Medium|~ Complete the Medium Achievements": "Diary",
        "~|Ardougne Achievements#Hard|~ Blood Bank Withdrawal": "Diary",
        "~|Ardougne Achievements#Hard|~ A Taste of the Exotic": "Diary",
        "~|Ardougne Achievements#Hard|~ It's My Newt": "Diary",
        "~|Ardougne Achievements#Hard|~ Monkey Business": "Diary",
        "~|Ardougne Achievements#Hard|~ Who Wants to Watch the Watchtower?": "Diary",
        "~|Ardougne Achievements#Hard|~ Living on a Prayer": "Diary",
        "~|Ardougne Achievements#Hard|~ Vine-detta": "Diary",
        "~|Ardougne Achievements#Hard|~ Get Your Stinking Hands Off Me": "Diary",
        "~|Ardougne Achievements#Hard|~ It Just Croaked": "Diary",
        "~|Ardougne Achievements#Hard|~ Not on My Watch": "Diary",
        "~|Ardougne Achievements#Hard|~ Ourania Mania": "Diary",
        "~|Ardougne Achievements#Hard|~ You're the Dirty Rascal": "Diary",
        "~|Ardougne Achievements#Hard|~ Nice View": "Diary",
        "~|Ardougne Achievements#Hard|~ Just Like That": "Diary",
        "~|Ardougne Achievements#Hard|~ Shadow Boxing": "Diary",
        "~|Ardougne Achievements#Hard|~ Brace Yourself": "Diary",
        "~|Ardougne Achievements#Hard|~ Artillery Strike": "Diary"
      },
      "reason": "Restore required Hard task 17 (Artillery Strike), retaining all 16 other same-tier duties and the Medium prerequisite. See provenance.ardougneHard."
    }
  ]
};
