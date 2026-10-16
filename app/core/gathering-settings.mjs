// Calculator choices are application preferences, separate from the data pack.
import { bankingSettingDefinitions } from './banking-settings.mjs';

// Older providers can omit the calculator controls. These authored presentation
// defaults do not add dataset rules or change an installed provider's contract.
export const calculatorBankingSettingDefinitions = bankingSettingDefinitions.length ? bankingSettingDefinitions : Object.freeze([
  { id: 'gatheringMode', type: 'enum', default: 'drop', options: ['drop', 'bank'],
    label: 'Finish each backpack', description: 'Drop resources or include a reviewed bank trip in the estimate.' },
  { id: 'gatheringOreBox', type: 'enum', default: 'none', options: Object.freeze(['none', 'bronze', 'iron', 'steel', 'mithril', 'adamant', 'rune']),
    label: 'Ore box owned', description: 'Choose the box you own. Reachable sources do not prove ownership.' },
  { id: 'gatheringWoodBox', type: 'enum', default: 'none', options: Object.freeze(['none', 'basic', 'oak', 'willow', 'teak', 'maple', 'acadia']),
    label: 'Wood box owned', description: 'Choose the box you own. Reachable sources do not prove ownership.' },
].map(row => Object.freeze(row)));

export const gatheringSettingDefinitions = Object.freeze([
  { id: 'gatheringProcessing', type: 'enum', default: 'none', options: ['none', 'cook-drop', 'fletch-drop'],
    label: 'Process before dropping', description: 'Include Cooking or Fletching time and extra XP. Uses your saved personal level; yew fletching requires membership.' },
  { id: 'gatheringCookingFacility', type: 'enum', default: 'unknown', options: ['unknown', 'fire', 'range'],
    label: 'Cooking at the spot', description: 'Confirm a usable fire or range beside the fish. Fire-making, fuel and travel to a cooker are not included.' },
  { id: 'gatheringSurge', type: 'enum', default: 'off', options: ['off', 'on'],
    label: 'Use Surge', description: 'Choose On only if you have unlocked Surge (Agility 5). Saves walking time on clear straight stretches.' },
  { id: 'gatheringLodestones', type: 'enum', default: 'on', options: ['on', 'off'],
    label: 'Use unlocked lodestones', description: 'Compare ordinary Home Teleport with walking. Uses your personal teleport confirmations and verified landing tiles.' },
  { id: 'gatheringCookingSuccess', type: 'enum', default: 'unknown', options: ['unknown', '50', '75', '90', '100'], advanced: true,
    label: 'Cooking success estimate', description: 'Optional scenario for fish that can still burn. Unknown shows an XP range; 100% assumes no burns.' },
].map(row => Object.freeze(row)));
