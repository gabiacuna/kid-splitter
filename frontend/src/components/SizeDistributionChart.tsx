import type { ClassAssignment } from '../lib/types';

interface Props {
  assignments: ClassAssignment[];
  numClasses: number;
}

export default function SizeDistributionChart({ assignments, numClasses }: Props) {
  const sizes: number[] = Array(numClasses).fill(0);
  for (const a of assignments) {
    const idx = a.class_number - 1;
    if (idx >= 0 && idx < numClasses) sizes[idx]++;
  }
  const max = Math.max(...sizes, 1);

  return (
    <div className="bar-chart">
      {sizes.map((size, i) => (
        <div key={i} className="bar-item">
          <span className="bar-label">{size}</span>
          <div className="bar-track">
            <div className="bar-fill" style={{ height: `${(size / max) * 100}%` }} />
          </div>
          <span className="bar-label">C{i + 1}</span>
        </div>
      ))}
    </div>
  );
}
