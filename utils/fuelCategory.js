// Shared fuel-type grouping: 'petrol' covers HSD+MS+MSP combined, 'cng' is
// separate. Used to route khata/vendor amounts and cash to the correct
// cashbook category based on which nozzle the entry was recorded on.
const CATEGORY_FUEL_TYPES = {
  petrol: ['HSD', 'MS', 'MSP'],
  cng: ['CNG'],
};

function categoryForFuelName(fuelName) {
  if (CATEGORY_FUEL_TYPES.petrol.includes(fuelName)) return 'petrol';
  if (CATEGORY_FUEL_TYPES.cng.includes(fuelName)) return 'cng';
  return null;
}

module.exports = { CATEGORY_FUEL_TYPES, categoryForFuelName };
