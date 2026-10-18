extends SceneTree

const Generator := preload("res://scripts/island_generator.gd")

var failures := 0


func _initialize() -> void:
	var generator := Generator.new()
	_check_smoothing(generator)
	var seeds := range(200)
	seeds.append_array([915833, 934742, 271828, 808080, 7305, 686718, 719633, 829942, 534481])
	var min_area := Generator.WIDTH * Generator.HEIGHT
	var max_area := 0
	var min_aspect := INF
	var max_aspect := 0.0
	var mixed_coasts := 0
	var exposure_coast := PackedInt32Array()
	exposure_coast.resize(10)
	var exposure_sand := PackedInt32Array()
	exposure_sand.resize(10)
	for world_seed in seeds:
		var world := generator.generate(world_seed)
		_check(not world.is_empty(), "Seed %d generates successfully." % world_seed)
		if world.is_empty():
			continue
		var cells: PackedByteArray = world["cells"]
		var heights: PackedFloat32Array = world["heights"]
		_check(cells.size() == Generator.WIDTH * Generator.HEIGHT, "Map dimensions.")
		_check(heights.size() == cells.size(), "Height-field dimensions.")
		_check(world["sea_level"] == Generator.SEA_LEVEL, "Shared sea level.")
		_check(world["generator_version"] == Generator.GENERATOR_VERSION, "Generator version.")
		_check(world["land_count"] >= Generator.MIN_LAND, "Minimum land area.")
		_check(world["land_count"] <= Generator.MAX_LAND, "Maximum land area.")
		for y in range(Generator.HEIGHT):
			for x in range(Generator.WIDTH):
				var index := y * Generator.WIDTH + x
				_check(is_finite(heights[index]), "Finite height values.")
				_check(cells[index] == int(heights[index] > world["sea_level"]), "Height field is the land source of truth.")
				if x < Generator.BORDER or x >= Generator.WIDTH - Generator.BORDER or y < Generator.BORDER or y >= Generator.HEIGHT - Generator.BORDER:
					_check(heights[index] <= Generator.SHALLOW_LEVEL, "Deep-water border.")
		_check(_reachable_count(cells, 1, cells.find(1), false) == cells.count(1), "Exactly one connected landmass.")
		_check(_reachable_count(cells, 0, 0, true) == cells.count(0), "No enclosed water holes.")
		var coast_distance: PackedInt32Array = generator._coast_distance(cells)
		for index in range(heights.size()):
			if cells[index] == 1 and heights[index] <= Generator.SEA_LEVEL + Generator.BEACH_LEVEL:
				_check(coast_distance[index] <= ceili(Generator.BEACH_LEVEL / Generator.GENTLE_SLOPE), "Sand lies on the shore, not inland.")
		var shelf := PackedByteArray()
		shelf.resize(cells.size())
		var sand_count := 0
		var grass_count := 0
		var beach_coast := 0
		var cliff_coast := 0
		for index in range(heights.size()):
			shelf[index] = int(heights[index] > Generator.SEA_LEVEL + Generator.SHALLOW_LEVEL)
			if cells[index] == 1:
				var sand := heights[index] <= Generator.SEA_LEVEL + Generator.BEACH_LEVEL
				if sand:
					sand_count += 1
				else:
					grass_count += 1
				var x := index % Generator.WIDTH
				var y := index / Generator.WIDTH
				if _touches_water(cells, x, y):
					var bucket := clampi(int(generator._water_fraction(cells, x, y) * 10.0), 0, 9)
					exposure_coast[bucket] += 1
					if sand:
						exposure_sand[bucket] += 1
						beach_coast += 1
					else:
						cliff_coast += 1
			elif shelf[index] == 1:
				_check(_near_land(cells, index % Generator.WIDTH, index / Generator.WIDTH, Generator.SHALLOW_ZONE), "Shallows stay within %d tiles of land." % Generator.SHALLOW_ZONE)
		_check(sand_count > 0 and grass_count > 0, "Height field supplies both sand and grass.")
		_check(shelf.count(1) > cells.count(1), "Coastal shallows are present.")
		_check(_reachable_count(shelf, 1, cells.find(1), true) == shelf.count(1), "Shallows connect to the coast, not discarded islands.")
		if beach_coast > 0 and cliff_coast > 0:
			mixed_coasts += 1
		if world_seed < 10:
			var repeated: Dictionary = generator.generate(world_seed)
			_check(repeated["cells"] == cells, "Same seed reproduces terrain.")
			_check(repeated["heights"] == heights, "Same seed reproduces continuous heights.")
		min_area = mini(min_area, world["land_count"])
		max_area = maxi(max_area, world["land_count"])
		var bounds := _land_bounds(cells)
		var aspect := float(bounds.size.x) / bounds.size.y
		min_aspect = minf(min_aspect, aspect)
		max_aspect = maxf(max_aspect, aspect)
	var first: Dictionary = generator.generate(42)
	var second: Dictionary = generator.generate(43)
	_check(first["cells"] != second["cells"], "Different seeds change terrain.")
	_check(float(max_area) / min_area >= 1.5, "Seeds vary in substantial land area, not only edge detail.")
	_check(max_aspect / min_aspect >= 1.6, "Seeds vary in overall proportions.")
	_check(mixed_coasts >= seeds.size() * 0.8, "Most coastlines mix beaches and cliffs.")
	var sheltered := _sand_share(exposure_coast, exposure_sand, 0, 4)
	var exposed := _sand_share(exposure_coast, exposure_sand, 5, 10)
	_check(sheltered > exposed + 0.25, "Sheltered coast is sandier than exposed coast.")
	if failures == 0:
		print("PASS: %d seeds, heights, smoothing, border, connectivity, holes, determinism, shallows." % seeds.size())
		print("Land area: %d..%d tiles. Aspect ratio: %.2f..%.2f." % [min_area, max_area, min_aspect, max_aspect])
		print("Coasts with both beach and cliff: %d of %d seeds." % [mixed_coasts, seeds.size()])
		print("Shoreline tiles that are sand: sheltered %.0f%%, exposed %.0f%%." % [sheltered * 100.0, exposed * 100.0])
	else:
		print("Coasts mixed: %d of %d. Sand share sheltered %.2f, exposed %.2f." % [mixed_coasts, seeds.size(), sheltered, exposed])
	quit(1 if failures else 0)


func _sand_share(coast: PackedInt32Array, sand: PackedInt32Array, from: int, to: int) -> float:
	var total := 0
	var sandy := 0
	for bucket in range(from, to):
		total += coast[bucket]
		sandy += sand[bucket]
	return float(sandy) / maxi(total, 1)


func _touches_water(cells: PackedByteArray, x: int, y: int) -> bool:
	for offset in [Vector2i.LEFT, Vector2i.RIGHT, Vector2i.UP, Vector2i.DOWN]:
		var point: Vector2i = Vector2i(x, y) + offset
		if point.x < 0 or point.x >= Generator.WIDTH or point.y < 0 or point.y >= Generator.HEIGHT or cells[point.y * Generator.WIDTH + point.x] == 0:
			return true
	return false


func _near_land(cells: PackedByteArray, x: int, y: int, reach: int) -> bool:
	for dy in range(-reach, reach + 1):
		for dx in range(-reach, reach + 1):
			var nx := x + dx
			var ny := y + dy
			if nx >= 0 and nx < Generator.WIDTH and ny >= 0 and ny < Generator.HEIGHT and cells[ny * Generator.WIDTH + nx] == 1:
				return true
	return false


func _check_smoothing(generator: RefCounted) -> void:
	var heights := PackedFloat32Array()
	heights.resize(Generator.WIDTH * Generator.HEIGHT)
	heights.fill(-0.5)
	var isolated := 12 * Generator.WIDTH + 12
	heights[isolated] = 0.5
	var center := Vector2i(32, 24)
	for offset in [Vector2i(-1, -1), Vector2i(0, -1), Vector2i(1, -1), Vector2i(-1, 0), Vector2i(1, 0)]:
		heights[(center.y + offset.y) * Generator.WIDTH + center.x + offset.x] = 0.5
	var snapshot := heights.duplicate()
	var result: PackedFloat32Array = generator._smooth(heights)
	_check(result[isolated] <= Generator.SEA_LEVEL, "Smoothing removes isolated land.")
	_check(result[center.y * Generator.WIDTH + center.x] > Generator.SEA_LEVEL, "Five land neighbors fill water.")
	_check(heights == snapshot, "Smoothing reads a snapshot instead of mutating in scan order.")


func _land_bounds(cells: PackedByteArray) -> Rect2i:
	var minimum := Vector2i(Generator.WIDTH, Generator.HEIGHT)
	var maximum := Vector2i.ZERO
	for index in range(cells.size()):
		if cells[index] == 1:
			var point := Vector2i(index % Generator.WIDTH, index / Generator.WIDTH)
			minimum = minimum.min(point)
			maximum = maximum.max(point)
	return Rect2i(minimum, maximum - minimum + Vector2i.ONE)


func _reachable_count(cells: PackedByteArray, value: int, start: int, diagonal: bool) -> int:
	if start < 0 or cells[start] != value:
		return 0
	var visited := {start: true}
	var frontier := [start]
	while not frontier.is_empty():
		var index: int = frontier.pop_back()
		var x := index % Generator.WIDTH
		var y := index / Generator.WIDTH
		for dy in range(-1, 2):
			for dx in range(-1, 2):
				if dx == 0 and dy == 0:
					continue
				if not diagonal and dx != 0 and dy != 0:
					continue
				var nx := x + dx
				var ny := y + dy
				if nx < 0 or nx >= Generator.WIDTH or ny < 0 or ny >= Generator.HEIGHT:
					continue
				var next := ny * Generator.WIDTH + nx
				if cells[next] == value and not visited.has(next):
					visited[next] = true
					frontier.append(next)
	return visited.size()


func _check(condition: bool, message: String) -> void:
	if not condition:
		failures += 1
		push_error(message)
