const values = [
  { day: '01', val: 1160 },
  { day: '03', val: 1880 },
  { day: '04', val: 969 },
  { day: '08', val: 1875 },
  { day: '10', val: 1126 },
  { day: '11', val: 1007 },
  { day: '15', val: 170 },
  { day: '17', val: 617 },
  { day: '18', val: 789 },
  { day: '22', val: 1210 },
  { day: '24', val: 0 },
  { day: '25', val: 0 },
  { day: '29', val: 435 },
  { day: '31', val: 1512 },
  { day: '04j', val: 190 },
  { day: '11j', val: 202 },
  { day: '18j', val: 10 },
];
const target = 2504;

function subsetSum(numbers, target, partial = [], partial_sum = 0) {
  if (partial_sum === target) {
    console.log("Encontrado:", partial.map(x => `${x.day}: ${x.val}`));
  }
  if (partial_sum >= target) return;

  for (let i = 0; i < numbers.length; i++) {
    const n = numbers[i];
    const remaining = numbers.slice(i + 1);
    subsetSum(remaining, target, [...partial, n], partial_sum + n.val);
  }
}

subsetSum(values.filter(x => x.val > 0), target);
