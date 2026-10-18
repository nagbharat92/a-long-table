extends RefCounted

const Generator := preload("res://scripts/island_generator.gd")
const TILE_SIZE := 4
const CLIFF_DEPTH := 5


static func in_bounds(cell: Vector2i) -> bool:
	return cell.x >= 0 and cell.y >= 0 and cell.x < Generator.WIDTH and cell.y < Generator.HEIGHT


static func is_land(heights: PackedFloat32Array, cell: Vector2i) -> bool:
	return in_bounds(cell) and heights[cell.y * Generator.WIDTH + cell.x] > Generator.SEA_LEVEL


static func is_grass(heights: PackedFloat32Array, cell: Vector2i) -> bool:
	return in_bounds(cell) and heights[cell.y * Generator.WIDTH + cell.x] > Generator.BEACH_LEVEL


static func is_cliff(heights: PackedFloat32Array, cell: Vector2i) -> bool:
	return is_grass(heights, cell) and not is_land(heights, cell + Vector2i.DOWN)


static func world_cell(point: Vector2) -> Vector2i:
	return Vector2i((point / TILE_SIZE).floor())


static func cell_center(cell: Vector2i) -> Vector2:
	return (Vector2(cell) + Vector2.ONE * 0.5) * TILE_SIZE
