export type Fraction = 'BLUE' | 'GREEN' | 'EMPTY';

export interface Cell {
  fraction: Fraction;
  age: number;
}

export type Grid = Cell[][];

export type ProcessingDirection = 'NORTH' | 'SOUTH' | 'EAST' | 'WEST';

export interface SimulationStats {
  iteration: number;
  blueCount: number;
  greenCount: number;
  emptyCount: number;
}
