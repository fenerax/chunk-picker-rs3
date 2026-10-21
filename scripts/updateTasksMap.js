const fs = require('fs');
const path = require('path');

// The upstream map is an archival seed. Regeneration never writes to it.
const TASKSMAP_FILE = path.join(__dirname, '../reference/original-picker/tasksMap.json');
const CURRENT_FILE = path.join(__dirname, '../app/data/legacy-task-current.json');
const HISTORY_FILE = path.join(__dirname, '../app/data/legacy-task-history.json');

function formatEquip(equip, chunkInfo) {
    if (!chunkInfo['equipment'][equip] || !chunkInfo['equipment'][equip].hasOwnProperty('formatted_name')) {
        return equip.toLowerCase();
    } else {
        return chunkInfo['equipment'][equip]['formatted_name'];
    }
}

function gcd(a, b) {
    if (b < 0.0000001) return a;

    return gcd(b, Math.floor(a % b));
}

function findFraction(fraction, isRoundedDenominator) {
    if (isNaN(fraction)) {
        return fraction;
    } else {
        let len = fraction.toString().length - 2;

        let denominator = Math.pow(10, len);
        let numerator = fraction * denominator;

        let divisor = gcd(numerator, denominator);

        numerator /= divisor;
        denominator /= divisor;
        if (isRoundedDenominator) {
            return 1 + '/' + (+(Math.floor(Math.round((denominator/numerator) + "e+2")  + "e-2"))).toString().replace(/(\d)(?=(\d\d\d)+(?!\d))/g, "$1,");
        } else {
            return 1 + '/' + (+(Math.round((denominator/numerator) + "e+2")  + "e-2")).toString().replace(/(\d)(?=(\d\d\d)+(?!\d))/g, "$1,");
        }
    }
}

function readJson(file, fallback) {
	return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf-8')) : fallback;
}

function saveJson(file, value) {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const temporary = `${file}.${process.pid}.tmp`;
	try {
		fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n');
		fs.renameSync(temporary, file);
	} finally {
		if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
	}
}

/** Recreate upstream display labels only; labels are not permanent task IDs. */
function generateTaskNames(chunkinfo) {
	let allTaskNames = [];
	// Standard tasks
	chunkinfo.hasOwnProperty('challenges') && Object.keys(chunkinfo['challenges']).filter((skill) => skill !== 'Nonskill').forEach((skill) => {
		allTaskNames.push(...Object.keys(chunkinfo['challenges'][skill]));
	});
	// BiS tasks
	const vowels = ['a', 'e', 'i', 'o', 'u'];
	chunkinfo.hasOwnProperty('equipment') && allTaskNames.push(...Object.keys(chunkinfo['equipment']).map((equip) => {
		let article = vowels.includes(equip.toLowerCase().charAt(0)) ? ' an ' : ' a ';
		article = (equip.toLowerCase().charAt(equip.toLowerCase().length - 1) === 's' || (equip.toLowerCase().charAt(equip.toLowerCase().length - 1) === ')' && equip.toLowerCase().split('(')[0].trim().charAt(equip.toLowerCase().split('(')[0].trim().length - 1) === 's')) ? ' ' : article;
		return 'Obtain' + article + '~|' + formatEquip(equip, chunkinfo).replaceAll('#', '/') + '|~';
	}));
	const monsters = [];
	chunkinfo.hasOwnProperty('chunks') && Object.keys(chunkinfo['chunks']).forEach((chunk) => {
		if (chunkinfo['chunks'][chunk].hasOwnProperty('Sections')) {
			Object.keys(chunkinfo['chunks'][chunk]['Sections']).forEach((section) => {
				if (chunkinfo['chunks'][chunk]['Sections'][section].hasOwnProperty('Monster')) {
					monsters.push(...Object.keys(chunkinfo['chunks'][chunk]['Sections'][section]['Monster']));
				}
			});
		} else {
			if (chunkinfo['chunks'][chunk].hasOwnProperty('Monster')) {
				monsters.push(...Object.keys(chunkinfo['chunks'][chunk]['Monster']));
			}
		}
	});
	// Kill X tasks
	allTaskNames.push(...monsters.map((monster) => {
		return 'Kill X ~|' + monster + '|~';
	}));
	const drops = [];
	const monsterDrops = [];
	chunkinfo.hasOwnProperty('drops') && Object.keys(chunkinfo['drops']).forEach((monster) => {
		Object.keys(chunkinfo['drops'][monster]).forEach((drop) => {
			if (chunkinfo['codeItems']['dropTables'].hasOwnProperty(drop)) {
				drops.push(...Object.keys(chunkinfo['codeItems']['dropTables'][drop]));
				Object.keys(chunkinfo['drops'][monster][drop]).forEach((quantity) => {
					Object.keys(chunkinfo['codeItems']['dropTables'][drop]).forEach((droptableDrop) => {					
						let calcedQuantity;
						if (chunkinfo['codeItems']['dropTables'][drop][droptableDrop].split('@')[1].includes(' (noted)')) {
							if (chunkinfo['codeItems']['dropTables'][drop][droptableDrop].split('@')[1].includes(' (F2P)')) {
								calcedQuantity = (isNaN(chunkinfo['codeItems']['dropTables'][drop][droptableDrop].split('@')[1].split(' (noted)')[0] * quantity) ? chunkinfo['codeItems']['dropTables'][drop][droptableDrop].split('@')[1].split(' (noted)')[0] : chunkinfo['codeItems']['dropTables'][drop][droptableDrop].split('@')[1].split(' (noted)')[0] * quantity) + ' (noted) (F2P)';
							} else {
								calcedQuantity = (isNaN(chunkinfo['codeItems']['dropTables'][drop][droptableDrop].split('@')[1].split(' (noted)')[0] * quantity) ? chunkinfo['codeItems']['dropTables'][drop][droptableDrop].split('@')[1].split(' (noted)')[0] : chunkinfo['codeItems']['dropTables'][drop][droptableDrop].split('@')[1].split(' (noted)')[0] * quantity) + ' (noted)';
							}
						} else {
							if (chunkinfo['codeItems']['dropTables'][drop][droptableDrop].split('@')[1].includes(' (F2P)')) {
								calcedQuantity = (isNaN(chunkinfo['codeItems']['dropTables'][drop][droptableDrop].split('@')[1].split(' (F2P)')[0] * quantity) ? chunkinfo['codeItems']['dropTables'][drop][droptableDrop].split('@')[1].split(' (F2P)')[0] : chunkinfo['codeItems']['dropTables'][drop][droptableDrop].split('@')[1].split(' (F2P)')[0] * quantity) + ' (F2P)';
							} else {
								calcedQuantity = (isNaN(chunkinfo['codeItems']['dropTables'][drop][droptableDrop].split('@')[1] * quantity) ? chunkinfo['codeItems']['dropTables'][drop][droptableDrop].split('@')[1] : chunkinfo['codeItems']['dropTables'][drop][droptableDrop].split('@')[1] * quantity);
							}
						}
						monsterDrops.push(`${monster.replace('[+]', '')}: ~|${droptableDrop}|~ (${calcedQuantity}) (${isNaN(parseFloat(chunkinfo['codeItems']['dropTables'][drop][droptableDrop].split('@')[0].split('/')[0].replaceAll('~', '') * chunkinfo['drops'][monster][drop][quantity].split('/')[0]) / parseFloat(chunkinfo['codeItems']['dropTables'][drop][droptableDrop].split('@')[0].split('/')[1] * chunkinfo['drops'][monster][drop][quantity].split('/')[1])) ? findFraction(parseFloat(chunkinfo['codeItems']['dropTables'][drop][droptableDrop].split('@')[0].split('/')[0].replaceAll('~', '')) / parseFloat(chunkinfo['codeItems']['dropTables'][drop][droptableDrop].split('@')[0].split('/')[1]), drop.includes('GeneralSeedDropTable')) : findFraction(parseFloat(chunkinfo['codeItems']['dropTables'][drop][droptableDrop].split('@')[0].split('/')[0].replaceAll('~', '') * chunkinfo['drops'][monster][drop][quantity].split('/')[0]) / parseFloat(chunkinfo['codeItems']['dropTables'][drop][droptableDrop].split('@')[0].split('/')[1] * chunkinfo['drops'][monster][drop][quantity].split('/')[1]), drop.includes('GeneralSeedDropTable'))})`);
					});
				});
			} else {
				drops.push(drop);
				Object.keys(chunkinfo['drops'][monster][drop]).forEach((quantity) => {
					monsterDrops.push(`${monster.replace('[+]', '')}: ~|${drop}|~ (${quantity}) (${isNaN(chunkinfo['drops'][monster][drop][quantity].split('/')[0] / chunkinfo['drops'][monster][drop][quantity].split('/')[1]) ? chunkinfo['drops'][monster][drop][quantity] : findFraction(chunkinfo['drops'][monster][drop][quantity].split('/')[0] / chunkinfo['drops'][monster][drop][quantity].split('/')[1])})`);
				});
			}
		});
	});
	chunkinfo.hasOwnProperty('skillItems') && chunkinfo['skillItems'].hasOwnProperty('Slayer') && Object.keys(chunkinfo['skillItems']['Slayer']).forEach((monster) => {
		Object.keys(chunkinfo['skillItems']['Slayer'][monster]).forEach((drop) => {
			if (chunkinfo['codeItems']['dropTables'].hasOwnProperty(drop)) {
				drops.push(...Object.keys(chunkinfo['codeItems']['dropTables'][drop]));
				Object.keys(chunkinfo['skillItems']['Slayer'][monster][drop]).forEach((quantity) => {
					Object.keys(chunkinfo['codeItems']['dropTables'][drop]).forEach((droptableDrop) => {					
						let calcedQuantity;
						if (chunkinfo['codeItems']['dropTables'][drop][droptableDrop].split('@')[1].includes(' (noted)')) {
							if (chunkinfo['codeItems']['dropTables'][drop][droptableDrop].split('@')[1].includes(' (F2P)')) {
								calcedQuantity = (isNaN(chunkinfo['codeItems']['dropTables'][drop][droptableDrop].split('@')[1].split(' (noted)')[0] * quantity) ? chunkinfo['codeItems']['dropTables'][drop][droptableDrop].split('@')[1].split(' (noted)')[0] : chunkinfo['codeItems']['dropTables'][drop][droptableDrop].split('@')[1].split(' (noted)')[0] * quantity) + ' (noted) (F2P)';
							} else {
								calcedQuantity = (isNaN(chunkinfo['codeItems']['dropTables'][drop][droptableDrop].split('@')[1].split(' (noted)')[0] * quantity) ? chunkinfo['codeItems']['dropTables'][drop][droptableDrop].split('@')[1].split(' (noted)')[0] : chunkinfo['codeItems']['dropTables'][drop][droptableDrop].split('@')[1].split(' (noted)')[0] * quantity) + ' (noted)';
							}
						} else {
							if (chunkinfo['codeItems']['dropTables'][drop][droptableDrop].split('@')[1].includes(' (F2P)')) {
								calcedQuantity = (isNaN(chunkinfo['codeItems']['dropTables'][drop][droptableDrop].split('@')[1].split(' (F2P)')[0] * quantity) ? chunkinfo['codeItems']['dropTables'][drop][droptableDrop].split('@')[1].split(' (F2P)')[0] : chunkinfo['codeItems']['dropTables'][drop][droptableDrop].split('@')[1].split(' (F2P)')[0] * quantity) + ' (F2P)';
							} else {
								calcedQuantity = (isNaN(chunkinfo['codeItems']['dropTables'][drop][droptableDrop].split('@')[1] * quantity) ? chunkinfo['codeItems']['dropTables'][drop][droptableDrop].split('@')[1] : chunkinfo['codeItems']['dropTables'][drop][droptableDrop].split('@')[1] * quantity);
							}
						}
						monsterDrops.push(`${monster.replace('[+]', '')}: ~|${droptableDrop}|~ (${calcedQuantity}) (${isNaN(parseFloat(chunkinfo['codeItems']['dropTables'][drop][droptableDrop].split('@')[0].split('/')[0].replaceAll('~', '') * chunkinfo['skillItems']['Slayer'][monster][drop][quantity].split('/')[0]) / parseFloat(chunkinfo['codeItems']['dropTables'][drop][droptableDrop].split('@')[0].split('/')[1] * chunkinfo['skillItems']['Slayer'][monster][drop][quantity].split('/')[1])) ? findFraction(parseFloat(chunkinfo['codeItems']['dropTables'][drop][droptableDrop].split('@')[0].split('/')[0].replaceAll('~', '')) / parseFloat(chunkinfo['codeItems']['dropTables'][drop][droptableDrop].split('@')[0].split('/')[1]), drop.includes('GeneralSeedDropTable')) : findFraction(parseFloat(chunkinfo['codeItems']['dropTables'][drop][droptableDrop].split('@')[0].split('/')[0].replaceAll('~', '') * chunkinfo['skillItems']['Slayer'][monster][drop][quantity].split('/')[0]) / parseFloat(chunkinfo['codeItems']['dropTables'][drop][droptableDrop].split('@')[0].split('/')[1] * chunkinfo['skillItems']['Slayer'][monster][drop][quantity].split('/')[1]), drop.includes('GeneralSeedDropTable'))})`);
					});
				});
			} else {
				drops.push(drop);
				Object.keys(chunkinfo['skillItems']['Slayer'][monster][drop]).forEach((quantity) => {
					monsterDrops.push(`${monster.replace('[+]', '')}: ~|${drop}|~ (${quantity}) (${isNaN(chunkinfo['skillItems']['Slayer'][monster][drop][quantity].split('/')[0] / chunkinfo['skillItems']['Slayer'][monster][drop][quantity].split('/')[1]) ? chunkinfo['skillItems']['Slayer'][monster][drop][quantity] : findFraction(chunkinfo['skillItems']['Slayer'][monster][drop][quantity].split('/')[0] / chunkinfo['skillItems']['Slayer'][monster][drop][quantity].split('/')[1])})`);
				});
			}
		});
	});
	chunkinfo.hasOwnProperty('skillItems') && chunkinfo['skillItems'].hasOwnProperty('Thieving') && Object.keys(chunkinfo['skillItems']['Thieving']).forEach((outputName) => {
		Object.keys(chunkinfo['skillItems']['Thieving'][outputName]).forEach((drop) => {
			if (chunkinfo['codeItems']['dropTables'].hasOwnProperty(drop)) {
				drops.push(...Object.keys(chunkinfo['codeItems']['dropTables'][drop]));
				Object.keys(chunkinfo['skillItems']['Thieving'][outputName][drop]).forEach((quantity) => {
					Object.keys(chunkinfo['codeItems']['dropTables'][drop]).forEach((droptableDrop) => {					
						let calcedQuantity;
						if (chunkinfo['codeItems']['dropTables'][drop][droptableDrop].split('@')[1].includes(' (noted)')) {
							if (chunkinfo['codeItems']['dropTables'][drop][droptableDrop].split('@')[1].includes(' (F2P)')) {
								calcedQuantity = (isNaN(chunkinfo['codeItems']['dropTables'][drop][droptableDrop].split('@')[1].split(' (noted)')[0] * quantity) ? chunkinfo['codeItems']['dropTables'][drop][droptableDrop].split('@')[1].split(' (noted)')[0] : chunkinfo['codeItems']['dropTables'][drop][droptableDrop].split('@')[1].split(' (noted)')[0] * quantity) + ' (noted) (F2P)';
							} else {
								calcedQuantity = (isNaN(chunkinfo['codeItems']['dropTables'][drop][droptableDrop].split('@')[1].split(' (noted)')[0] * quantity) ? chunkinfo['codeItems']['dropTables'][drop][droptableDrop].split('@')[1].split(' (noted)')[0] : chunkinfo['codeItems']['dropTables'][drop][droptableDrop].split('@')[1].split(' (noted)')[0] * quantity) + ' (noted)';
							}
						} else {
							if (chunkinfo['codeItems']['dropTables'][drop][droptableDrop].split('@')[1].includes(' (F2P)')) {
								calcedQuantity = (isNaN(chunkinfo['codeItems']['dropTables'][drop][droptableDrop].split('@')[1].split(' (F2P)')[0] * quantity) ? chunkinfo['codeItems']['dropTables'][drop][droptableDrop].split('@')[1].split(' (F2P)')[0] : chunkinfo['codeItems']['dropTables'][drop][droptableDrop].split('@')[1].split(' (F2P)')[0] * quantity) + ' (F2P)';
							} else {
								calcedQuantity = (isNaN(chunkinfo['codeItems']['dropTables'][drop][droptableDrop].split('@')[1] * quantity) ? chunkinfo['codeItems']['dropTables'][drop][droptableDrop].split('@')[1] : chunkinfo['codeItems']['dropTables'][drop][droptableDrop].split('@')[1] * quantity);
							}
						}
						monsterDrops.push(`[Thieving] ${outputName.replace('[+]', '')}: ~|${droptableDrop}|~ (${calcedQuantity}) (${isNaN(parseFloat(chunkinfo['codeItems']['dropTables'][drop][droptableDrop].split('@')[0].split('/')[0].replaceAll('~', '') * chunkinfo['skillItems']['Thieving'][outputName][drop][quantity].split('/')[0]) / parseFloat(chunkinfo['codeItems']['dropTables'][drop][droptableDrop].split('@')[0].split('/')[1] * chunkinfo['skillItems']['Thieving'][outputName][drop][quantity].split('/')[1])) ? findFraction(parseFloat(chunkinfo['codeItems']['dropTables'][drop][droptableDrop].split('@')[0].split('/')[0].replaceAll('~', '')) / parseFloat(chunkinfo['codeItems']['dropTables'][drop][droptableDrop].split('@')[0].split('/')[1]), drop.includes('GeneralSeedDropTable')) : findFraction(parseFloat(chunkinfo['codeItems']['dropTables'][drop][droptableDrop].split('@')[0].split('/')[0].replaceAll('~', '') * chunkinfo['skillItems']['Thieving'][outputName][drop][quantity].split('/')[0]) / parseFloat(chunkinfo['codeItems']['dropTables'][drop][droptableDrop].split('@')[0].split('/')[1] * chunkinfo['skillItems']['Thieving'][outputName][drop][quantity].split('/')[1]), drop.includes('GeneralSeedDropTable'))})`);
					});
				});
			} else {
				drops.push(drop);
				Object.keys(chunkinfo['skillItems']['Thieving'][outputName][drop]).forEach((quantity) => {
					monsterDrops.push(`[Thieving] ${outputName.replace('[+]', '')}: ~|${drop}|~ (${quantity}) (${isNaN(chunkinfo['skillItems']['Thieving'][outputName][drop][quantity].split('/')[0] / chunkinfo['skillItems']['Thieving'][outputName][drop][quantity].split('/')[1]) ? chunkinfo['skillItems']['Thieving'][outputName][drop][quantity] : findFraction(chunkinfo['skillItems']['Thieving'][outputName][drop][quantity].split('/')[0] / chunkinfo['skillItems']['Thieving'][outputName][drop][quantity].split('/')[1])})`);
				});
			}
		});
	});
	chunkinfo.hasOwnProperty('skillItems') && chunkinfo['skillItems'].hasOwnProperty('Hunter') && Object.keys(chunkinfo['skillItems']['Hunter']).filter((outputName) => outputName.includes('impling')).forEach((outputName) => {
		Object.keys(chunkinfo['skillItems']['Hunter'][outputName]).forEach((drop) => {
			if (chunkinfo['codeItems']['dropTables'].hasOwnProperty(drop)) {
				drops.push(...Object.keys(chunkinfo['codeItems']['dropTables'][drop]));
				Object.keys(chunkinfo['skillItems']['Hunter'][outputName][drop]).forEach((quantity) => {
					Object.keys(chunkinfo['codeItems']['dropTables'][drop]).forEach((droptableDrop) => {					
						let calcedQuantity;
						if (chunkinfo['codeItems']['dropTables'][drop][droptableDrop].split('@')[1].includes(' (noted)')) {
							if (chunkinfo['codeItems']['dropTables'][drop][droptableDrop].split('@')[1].includes(' (F2P)')) {
								calcedQuantity = (isNaN(chunkinfo['codeItems']['dropTables'][drop][droptableDrop].split('@')[1].split(' (noted)')[0] * quantity) ? chunkinfo['codeItems']['dropTables'][drop][droptableDrop].split('@')[1].split(' (noted)')[0] : chunkinfo['codeItems']['dropTables'][drop][droptableDrop].split('@')[1].split(' (noted)')[0] * quantity) + ' (noted) (F2P)';
							} else {
								calcedQuantity = (isNaN(chunkinfo['codeItems']['dropTables'][drop][droptableDrop].split('@')[1].split(' (noted)')[0] * quantity) ? chunkinfo['codeItems']['dropTables'][drop][droptableDrop].split('@')[1].split(' (noted)')[0] : chunkinfo['codeItems']['dropTables'][drop][droptableDrop].split('@')[1].split(' (noted)')[0] * quantity) + ' (noted)';
							}
						} else {
							if (chunkinfo['codeItems']['dropTables'][drop][droptableDrop].split('@')[1].includes(' (F2P)')) {
								calcedQuantity = (isNaN(chunkinfo['codeItems']['dropTables'][drop][droptableDrop].split('@')[1].split(' (F2P)')[0] * quantity) ? chunkinfo['codeItems']['dropTables'][drop][droptableDrop].split('@')[1].split(' (F2P)')[0] : chunkinfo['codeItems']['dropTables'][drop][droptableDrop].split('@')[1].split(' (F2P)')[0] * quantity) + ' (F2P)';
							} else {
								calcedQuantity = (isNaN(chunkinfo['codeItems']['dropTables'][drop][droptableDrop].split('@')[1] * quantity) ? chunkinfo['codeItems']['dropTables'][drop][droptableDrop].split('@')[1] : chunkinfo['codeItems']['dropTables'][drop][droptableDrop].split('@')[1] * quantity);
							}
						}
						monsterDrops.push(`${outputName.replace('[+]', '')}: ~|${droptableDrop}|~ (${calcedQuantity}) (${isNaN(parseFloat(chunkinfo['codeItems']['dropTables'][drop][droptableDrop].split('@')[0].split('/')[0].replaceAll('~', '') * chunkinfo['skillItems']['Hunter'][outputName][drop][quantity].split('/')[0]) / parseFloat(chunkinfo['codeItems']['dropTables'][drop][droptableDrop].split('@')[0].split('/')[1] * chunkinfo['skillItems']['Hunter'][outputName][drop][quantity].split('/')[1])) ? findFraction(parseFloat(chunkinfo['codeItems']['dropTables'][drop][droptableDrop].split('@')[0].split('/')[0].replaceAll('~', '')) / parseFloat(chunkinfo['codeItems']['dropTables'][drop][droptableDrop].split('@')[0].split('/')[1]), drop.includes('GeneralSeedDropTable')) : findFraction(parseFloat(chunkinfo['codeItems']['dropTables'][drop][droptableDrop].split('@')[0].split('/')[0].replaceAll('~', '') * chunkinfo['skillItems']['Hunter'][outputName][drop][quantity].split('/')[0]) / parseFloat(chunkinfo['codeItems']['dropTables'][drop][droptableDrop].split('@')[0].split('/')[1] * chunkinfo['skillItems']['Hunter'][outputName][drop][quantity].split('/')[1]), drop.includes('GeneralSeedDropTable'))})`);
					});
				});
			} else {
				drops.push(drop);
				Object.keys(chunkinfo['skillItems']['Hunter'][outputName][drop]).forEach((quantity) => {
					monsterDrops.push(`${outputName.replace('[+]', '')}: ~|${drop}|~ (${quantity}) (${isNaN(chunkinfo['skillItems']['Hunter'][outputName][drop][quantity].split('/')[0] / chunkinfo['skillItems']['Hunter'][outputName][drop][quantity].split('/')[1]) ? chunkinfo['skillItems']['Hunter'][outputName][drop][quantity] : findFraction(chunkinfo['skillItems']['Hunter'][outputName][drop][quantity].split('/')[0] / chunkinfo['skillItems']['Hunter'][outputName][drop][quantity].split('/')[1])})`);
				});
			}
		});
	});
	const birdNests = ["Bird nest (Wyson)", "Bird nest (seeds)", "Bird nest (ring)", "Bird nest (egg)"]
	birdNests.forEach((nest) => {
		chunkinfo['skillItems']?.['Nonskill']?.hasOwnProperty(nest + ' loot') && chunkinfo['challenges']?.['Nonskill']?.hasOwnProperty(nest + ' loot') && Object.keys(chunkinfo['skillItems']['Nonskill'][nest + ' loot']).forEach(drop => {
			chunkinfo['skillItems']['Nonskill'][nest + ' loot'].hasOwnProperty(drop) && Object.keys(chunkinfo['skillItems']['Nonskill'][nest + ' loot'][drop]).forEach(quantity => {
				monsterDrops.push(nest.replaceAll('[+]', '') + ': ~|' + drop + '|~ (' + (quantity || 'N/A') + ') (' + chunkinfo['skillItems']['Nonskill'][nest + ' loot'][drop][quantity] + ')');
			});
		});
	});
	// Every Drop tasks
	allTaskNames.push(...drops);
	// All Droptables tasks
	allTaskNames.push(...monsterDrops);
	const shopItems = [];
	chunkinfo.hasOwnProperty('shopItems') && Object.keys(chunkinfo['shopItems']).forEach((shop) => {
		shopItems.push(...Object.keys(chunkinfo['shopItems'][shop]).map((item) => {
			return `${shop}: ~|${item}|~`;
		}));
	});
	chunkinfo.hasOwnProperty('challenges') && chunkinfo['challenges'].hasOwnProperty('Nonskill') && Object.keys(chunkinfo['challenges']['Nonskill']).filter((name) => chunkinfo['challenges']['Nonskill'][name].hasOwnProperty('Source') && chunkinfo['challenges']['Nonskill'][name]['Source'] === 'shop' && chunkinfo['challenges']['Nonskill'][name].hasOwnProperty('Output')).forEach((name) => {
		let output = chunkinfo['challenges']['Nonskill'][name]['Output'];
		if (chunkinfo['skillItems']['Nonskill'].hasOwnProperty(output)) {
			shopItems.push(...Object.keys(chunkinfo['skillItems']['Nonskill'][output]).map((item) => {
				return `${name.split('|')[1]}: ~|${item}|~`;
			}));
		} else {
			shopItems.push(`${name.split('|')[1]}: ~|${output}|~`);
		}
	});
	// All Shops tasks
	allTaskNames.push(...shopItems);
	return [...new Set(allTaskNames)];
}

function record(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Keep all legacy decoders independently of the current display catalogue.
 * Conflicting historical assignments retain both codes instead of overwriting.
 */
function regenerateTaskMap({ taskNames, taskMap = {}, history = {} }) {
	if (!Array.isArray(taskNames) || taskNames.some(name => typeof name !== 'string' || !name.trim() || name === 'currentNextIndex')) {
		throw new TypeError('taskNames must contain nonempty task labels');
	}
	if (!record(taskMap) || !record(history) || (history.schemaVersion !== undefined && history.schemaVersion !== 1)) {
		throw new TypeError('Invalid legacy task map/history schema');
	}
	if (history.mappings !== undefined && !record(history.mappings)) throw new TypeError('Invalid historical mappings');
	if (history.tombstones !== undefined && !record(history.tombstones)) throw new TypeError('Invalid historical tombstones');
	if (history.conflicts !== undefined && !Array.isArray(history.conflicts)) throw new TypeError('Invalid historical conflicts');
	const associations = new Map();
	const mappings = new Map();
	let nextId = 1;
	const add = (label, id) => {
		if (typeof label !== 'string' || !label.trim() || label === 'currentNextIndex' || typeof id !== 'string' || !id.startsWith('t_')) {
			throw new TypeError('Invalid legacy label/code mapping');
		}
		if (!mappings.has(label)) mappings.set(label, id);
		const ids = associations.get(label) ?? new Set();
		ids.add(id);
		associations.set(label, ids);
		if (/^t_\d+$/.test(id)) {
			const number = Number(id.slice(2));
			if (!Number.isSafeInteger(number) || number < 1 || number === Number.MAX_SAFE_INTEGER) throw new RangeError('Legacy task allocation exhausted');
			nextId = Math.max(nextId, number + 1);
		}
	};
	for (const source of [history.mappings ?? {}, history.tombstones ?? {}, taskMap]) {
		for (const [label, id] of Object.entries(source)) {
			if (label === 'currentNextIndex') continue;
			add(label, id);
		}
	}
	for (const conflict of history.conflicts ?? []) {
		if (!record(conflict) || typeof conflict.label !== 'string' || !Array.isArray(conflict.ids)) throw new TypeError('Invalid historical conflict');
		for (const id of conflict.ids) add(conflict.label, id);
	}
	for (const source of [history, taskMap]) {
		if (source.currentNextIndex !== undefined) {
			if (!Number.isSafeInteger(source.currentNextIndex) || source.currentNextIndex < 1) throw new TypeError('Invalid currentNextIndex');
			nextId = Math.max(nextId, source.currentNextIndex);
		}
	}
	const current = new Map();
	for (const label of new Set(taskNames)) {
		let id = Object.hasOwn(taskMap, label) ? taskMap[label] : mappings.get(label);
		if (!id) {
			if (nextId === Number.MAX_SAFE_INTEGER) throw new RangeError('Legacy task allocation exhausted');
			id = `t_${nextId++}`;
			add(label, id);
		}
		current.set(label, id);
	}
	const tombstones = new Map([...mappings].filter(([label]) => !current.has(label)));
	const conflicts = [...associations].filter(([, ids]) => ids.size > 1)
		.map(([label, ids]) => ({ label, ids: [...ids].sort() }));
	return {
		current: { ...Object.fromEntries(current), currentNextIndex: nextId },
		history: {
			schemaVersion: 1,
			currentNextIndex: nextId,
			mappings: Object.fromEntries(mappings),
			tombstones: Object.fromEntries(tombstones),
			conflicts,
		},
	};
}

function run({
	definitionsFile = path.join(__dirname, '../rs3-chunkpicker-chunkinfo-export.json'),
	seedFile = TASKSMAP_FILE,
	currentFile = CURRENT_FILE,
	historyFile = HISTORY_FILE,
} = {}) {
	const archive = path.resolve(TASKSMAP_FILE);
	if ([currentFile, historyFile].some(file => path.resolve(file) === archive || path.resolve(file) === path.resolve(seedFile))) {
		throw new TypeError('The archival seed must remain read-only');
	}
	if (path.resolve(currentFile) === path.resolve(historyFile)) throw new TypeError('Current catalogue and history need separate files');
	const taskNames = generateTaskNames(readJson(definitionsFile));
	const seed = readJson(seedFile, {});
	const previous = readJson(currentFile, seed);
	// Include seed decoders even when a current authored catalogue already exists.
	const oldHistory = readJson(historyFile, {});
	const seeded = regenerateTaskMap({ taskNames: [], taskMap: seed, history: oldHistory }).history;
	const result = regenerateTaskMap({ taskNames, taskMap: previous, history: seeded });
	// Save history first: an interrupted current-catalogue replacement loses no decoder.
	saveJson(historyFile, result.history);
	saveJson(currentFile, result.current);
	return result;
}

module.exports = { generateTaskNames, regenerateTaskMap, run };

if (require.main === module) {
	try {
		const result = run();
		console.log(`Current labels: ${Object.keys(result.current).length - 1}; historical labels: ${Object.keys(result.history.mappings).length}; tombstones: ${Object.keys(result.history.tombstones).length}`);
	} catch (err) {
		console.error('Error updating task map:', err);
		process.exitCode = 1;
	}
}
