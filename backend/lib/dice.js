// ============================================================
// WESTEROS RPG — DICE ROLLER
// ============================================================

/**
 * Roll dice and return result
 * @param {number} count - number of dice
 * @param {number} sides - sides per die (default d10)
 * @param {number} bonus - flat bonus to add
 * @returns {{ rolls: number[], bonus: number, total: number }}
 */
export function rollDice(count = 2, sides = 10, bonus = 0) {
  const rolls = Array.from({ length: count }, () => Math.floor(Math.random() * sides) + 1);
  const total = rolls.reduce((a, b) => a + b, 0) + bonus;
  return { rolls, bonus, total };
}

/**
 * Roll a stat check against a difficulty class
 * @param {number} statValue - character's stat (1-10)
 * @param {number} difficulty - DC to beat
 * @param {string} statName - name of the stat being checked
 * @returns {{ rolls: number[], bonus: number, total: number, difficulty: number, success: boolean, stat: string }}
 */
export function statCheck(statValue, difficulty, statName) {
  const { rolls, bonus, total } = rollDice(2, 10, statValue);
  return {
    rolls,
    bonus: statValue,
    total,
    difficulty,
    success: total >= difficulty,
    stat: statName,
  };
}
