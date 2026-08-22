// Linear interpolation matching the manual dip-chart lookup: split the
// reading into row (tens) / col (ones), then interpolate toward the next
// cell using the fractional part, exactly like the paper chart is read.
function dipToLiters(grid, dipReading) {
  const whole = Math.floor(dipReading);
  const fraction = dipReading - whole;
  const row = Math.floor(whole / 10);
  const col = whole % 10;

  if (!grid[row] || grid[row][col] == null) return null;
  const base = grid[row][col];
  if (fraction === 0) return base;

  const nextRow = col === 9 ? row + 1 : row;
  const nextCol = col === 9 ? 0 : col + 1;
  const next = grid[nextRow]?.[nextCol];
  if (next == null) return base;

  return base + (next - base) * fraction;
}

// Builds a { $gte, $lt } date range filter for ?month=1-12&year=YYYY, or
// returns null if either query param is missing/invalid.
function monthYearRange(query) {
  const month = Number(query.month);
  const year = Number(query.year);
  if (!Number.isInteger(month) || !Number.isInteger(year) || month < 1 || month > 12) {
    return null;
  }
  return { $gte: new Date(year, month - 1, 1), $lt: new Date(year, month, 1) };
}

// Builds a { $gte, $lt } range spanning just the calendar day of `date`,
// ignoring whatever time-of-day it carries — used to check "is there
// already an entry for this date" regardless of exact timestamp.
function dayRange(date) {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { $gte: start, $lt: end };
}

module.exports = { dipToLiters, monthYearRange, dayRange };
