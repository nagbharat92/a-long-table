extends Node2D

const Generator := preload("res://scripts/island_generator.gd")
const TILE_SIZE := 4
const OCEAN := Color("#2698ee")
const GRASS := Color("#85cc49")
const GRASS_LIGHT := Color("#bae879")
const SAND := Color("#e7cf85")
const SAND_LIGHT := Color("#f7e3a2")
const WET_SAND := Color("#cdae63")
const FOAM := Color("#d9f2fb")
const SHALLOWS := Color("#53b9e9")
const EDGE := Color("#304a40")

var heights := PackedFloat32Array()
var sea_level := 0.0
var world_seed := 0
var origin := Vector2.ZERO
var ocean_rect := Rect2(Vector2(-32, -32), Vector2(320, 256))


func set_world(world: Dictionary) -> void:
	heights = world["heights"]
	sea_level = world["sea_level"]
	world_seed = world["seed"]
	queue_redraw()


func set_ocean_rect(rect: Rect2) -> void:
	ocean_rect = rect.grow(2.0)
	queue_redraw()


func get_island_bounds() -> Rect2:
	var minimum := Vector2(Generator.WIDTH, Generator.HEIGHT)
	var maximum := Vector2.ZERO
	for y in range(Generator.HEIGHT):
		for x in range(Generator.WIDTH):
			if _is_land(x, y):
				minimum = minimum.min(Vector2(x, y))
				maximum = maximum.max(Vector2(x + 1, y + 1))
	# Include the coastal shelf and the south-facing cliff projection.
	return Rect2(origin + minimum * TILE_SIZE, (maximum - minimum) * TILE_SIZE).grow(
		Generator.SHALLOW_ZONE * TILE_SIZE + 1
	)


func _draw() -> void:
	draw_rect(ocean_rect, OCEAN)
	for y in range(int(floorf(ocean_rect.position.y / 40.0)) * 40, int(ocean_rect.end.y) + 40, 40):
		for x in range(int(floorf(ocean_rect.position.x / 56.0)) * 56, int(ocean_rect.end.x) + 56, 56):
			var wave := Vector2(x + (28 if posmod(y / 40, 2) == 0 else 0), y)
			draw_rect(Rect2(wave, Vector2(4, 1)), Color("#49acf2"))
			draw_rect(Rect2(wave + Vector2(2, 1), Vector2(4, 1)), Color("#49acf2"))
	if heights.is_empty():
		return
	_draw_shallows()
	for y in range(Generator.HEIGHT):
		for x in range(Generator.WIDTH):
			if _is_cliff(x, y):
				_draw_cliff_face(origin + Vector2(x, y + 1) * TILE_SIZE)
	for y in range(Generator.HEIGHT):
		for x in range(Generator.WIDTH):
			if not _is_land(x, y):
				continue
			var point := origin + Vector2(x, y) * TILE_SIZE
			var grass := _is_grass(x, y)
			draw_rect(Rect2(point, Vector2.ONE * TILE_SIZE), GRASS if grass else SAND)
			if grass:
				_draw_detail(point, x, y)
			# Raised grass gets a hard dark rim. Beaches meet water with a soft wet line.
			var rim := EDGE if grass else WET_SAND
			var highlight := GRASS_LIGHT if grass else SAND_LIGHT
			if not _is_land(x, y - 1):
				draw_rect(Rect2(point, Vector2(TILE_SIZE, 1)), rim)
				draw_rect(Rect2(point + Vector2(1, 1), Vector2(TILE_SIZE - 2, 1)), highlight)
			if not _is_land(x - 1, y):
				draw_rect(Rect2(point, Vector2(1, TILE_SIZE)), rim)
			if not _is_land(x + 1, y):
				draw_rect(Rect2(point + Vector2(TILE_SIZE - 1, 0), Vector2(1, TILE_SIZE)), rim)
			if not _is_land(x, y + 1):
				if grass:
					draw_rect(Rect2(point + Vector2(0, TILE_SIZE - 1), Vector2(TILE_SIZE, 1)), EDGE)
				else:
					draw_rect(Rect2(point + Vector2(0, TILE_SIZE - 1), Vector2(TILE_SIZE, 1)), WET_SAND)
					draw_rect(Rect2(point + Vector2(0, TILE_SIZE), Vector2(TILE_SIZE, 1)), FOAM)


func _draw_shallows() -> void:
	for y in range(Generator.HEIGHT):
		for x in range(Generator.WIDTH):
			var height := heights[y * Generator.WIDTH + x]
			if height <= sea_level and height > sea_level + Generator.SHALLOW_LEVEL:
				var point := origin + Vector2(x, y) * TILE_SIZE
				draw_rect(Rect2(point, Vector2.ONE * TILE_SIZE), SHALLOWS)


func _draw_cliff_face(point: Vector2) -> void:
	draw_rect(Rect2(point, Vector2(TILE_SIZE, 5)), Color("#2387c7"))
	draw_rect(Rect2(point, Vector2(TILE_SIZE, 4)), EDGE)
	draw_rect(Rect2(point, Vector2(TILE_SIZE, 3)), Color("#b47747"))
	draw_rect(Rect2(point, Vector2(TILE_SIZE, 1)), Color("#d49b56"))


func _draw_detail(point: Vector2, x: int, y: int) -> void:
	var value := ((x * 73856093) ^ (y * 19349663) ^ world_seed) & 0x7fffffff
	if value % 41 == 0:
		draw_rect(Rect2(point, Vector2.ONE * TILE_SIZE), Color("#8bd04d"))
	elif value % 53 == 0:
		draw_rect(Rect2(point, Vector2.ONE * TILE_SIZE), Color("#7fc645"))
	if value % 139 == 0 and _is_land(x, y + 1) and _is_land(x + 1, y):
		draw_rect(Rect2(point + Vector2(1, 2), Vector2(2, 1)), Color("#68ab3b"))
	elif value % 173 == 0:
		draw_rect(Rect2(point + Vector2(2, 2), Vector2(1, 1)), Color("#b1df6b"))


func _is_land(x: int, y: int) -> bool:
	if x < 0 or x >= Generator.WIDTH or y < 0 or y >= Generator.HEIGHT:
		return false
	return heights[y * Generator.WIDTH + x] > sea_level


func _is_grass(x: int, y: int) -> bool:
	return heights[y * Generator.WIDTH + x] > sea_level + Generator.BEACH_LEVEL


# One rule: a cliff is raised land dropping straight into water. Beaches never get one.
func _is_cliff(x: int, y: int) -> bool:
	return _is_land(x, y) and _is_grass(x, y) and not _is_land(x, y + 1)
