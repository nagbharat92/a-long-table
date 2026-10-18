extends RefCounted

const RESOLUTION := 2
const WIDTH := 64 * RESOLUTION
const HEIGHT := 48 * RESOLUTION
const BORDER := 3 * RESOLUTION
const MIN_LAND := 450 * RESOLUTION * RESOLUTION
const MAX_LAND := 1900 * RESOLUTION * RESOLUTION
const MAX_ATTEMPTS := 32
const GENERATOR_VERSION := 4
const SEA_LEVEL := 0.0
const BEACH_LEVEL := 0.12
const SHALLOW_LEVEL := -0.20
const COAST_EPSILON := 0.02
const GENTLE_SLOPE := 0.032 / RESOLUTION
const STEEP_SLOPE := 0.20 / RESOLUTION
const COAST_ZONE := 6 * RESOLUTION
const SHALLOW_ZONE := 3 * RESOLUTION
const EXPOSURE_RADIUS := 6 * RESOLUTION
const DIRECTIONS := [Vector2i.LEFT, Vector2i.RIGHT, Vector2i.UP, Vector2i.DOWN]


func generate(world_seed: int) -> Dictionary:
	for attempt in range(MAX_ATTEMPTS):
		var heights := _candidate(world_seed, attempt)
		for pass_index in range(2):
			heights = _smooth(heights)
		var cells := _land_mask(heights)
		cells = _largest_region(cells)
		_fill_lakes(cells)
		var land_count := cells.count(1)
		if land_count >= MIN_LAND and land_count <= MAX_LAND:
			_apply_topology(heights, cells)
			_condition_coast(heights, cells, world_seed)
			# Occupancy is a derived cache; the repaired height field remains authoritative.
			return {
				"seed": world_seed,
				"generator_version": GENERATOR_VERSION,
				"heights": heights,
				"sea_level": SEA_LEVEL,
				"cells": _land_mask(heights),
				"land_count": land_count,
			}
	push_error("Island generation exhausted its attempts for seed %d." % world_seed)
	return {}


func _candidate(world_seed: int, attempt: int) -> PackedFloat32Array:
	var terrain_seed := (world_seed ^ (attempt * 104729)) & 0x7fffffff
	var rng := RandomNumberGenerator.new()
	rng.seed = terrain_seed
	var broad := _noise(terrain_seed, 0.022 / RESOLUTION)
	var landforms := _noise(terrain_seed ^ 0x68bc21eb, 0.045 / RESOLUTION)
	var detail := _noise(terrain_seed ^ 0x02e5be93, 0.11 / RESOLUTION)
	var offset := Vector2(rng.randf_range(100.0, 1000.0), rng.randf_range(100.0, 1000.0))
	var center := Vector2(
		(WIDTH - 1) * 0.5 + rng.randf_range(-5.0, 5.0) * RESOLUTION,
		(HEIGHT - 1) * 0.5 + rng.randf_range(-3.0, 3.0) * RESOLUTION
	)
	var radius := Vector2(
		WIDTH * rng.randf_range(0.30, 0.47),
		HEIGHT * rng.randf_range(0.28, 0.50)
	)
	var angle := rng.randf_range(-0.85, 0.85)
	var bias := rng.randf_range(-0.08, 0.08)
	var heights := PackedFloat32Array()
	heights.resize(WIDTH * HEIGHT)
	for y in range(HEIGHT):
		for x in range(WIDTH):
			var point := Vector2(x, y) + offset * RESOLUTION
			var relative := (Vector2(x, y) - center).rotated(angle) / radius
			var shape := (1.0 - relative.length_squared()) * 0.90
			var height := (
				shape
				+ broad.get_noise_2dv(point) * 1.30
				+ landforms.get_noise_2dv(point) * 0.62
				+ detail.get_noise_2dv(point) * 0.10
				- 0.32 + bias
			)
			if x < BORDER or x >= WIDTH - BORDER or y < BORDER or y >= HEIGHT - BORDER:
				height = -0.70
			heights[y * WIDTH + x] = height
	_reserve_ocean(heights)
	return heights


func _reserve_ocean(heights: PackedFloat32Array) -> void:
	# Shift the whole field below its rim, rather than stamping a frame into the coast.
	var highest_rim := -INF
	for x in range(BORDER, WIDTH - BORDER):
		highest_rim = maxf(highest_rim, heights[BORDER * WIDTH + x])
		highest_rim = maxf(highest_rim, heights[(HEIGHT - BORDER - 1) * WIDTH + x])
	for y in range(BORDER, HEIGHT - BORDER):
		highest_rim = maxf(highest_rim, heights[y * WIDTH + BORDER])
		highest_rim = maxf(highest_rim, heights[y * WIDTH + WIDTH - BORDER - 1])
	var offset := maxf(0.0, highest_rim - SEA_LEVEL + 0.08)
	if offset > 0.0:
		for index in range(heights.size()):
			heights[index] -= offset


func _noise(noise_seed: int, frequency: float) -> FastNoiseLite:
	var noise := FastNoiseLite.new()
	noise.seed = noise_seed & 0x7fffffff
	noise.noise_type = FastNoiseLite.TYPE_SIMPLEX_SMOOTH
	noise.fractal_type = FastNoiseLite.FRACTAL_NONE
	noise.frequency = frequency
	return noise


func _land_mask(heights: PackedFloat32Array) -> PackedByteArray:
	var cells := PackedByteArray()
	cells.resize(heights.size())
	for index in range(heights.size()):
		cells[index] = int(heights[index] > SEA_LEVEL)
	return cells


func _smooth(heights: PackedFloat32Array) -> PackedFloat32Array:
	var result := heights.duplicate()
	for y in range(BORDER, HEIGHT - BORDER):
		for x in range(BORDER, WIDTH - BORDER):
			var neighbors := 0
			for dy in range(-1, 2):
				for dx in range(-1, 2):
					if dx != 0 or dy != 0:
						neighbors += int(heights[(y + dy) * WIDTH + x + dx] > SEA_LEVEL)
			var index := y * WIDTH + x
			if heights[index] > SEA_LEVEL and neighbors < 3:
				result[index] = SEA_LEVEL - COAST_EPSILON
			elif heights[index] <= SEA_LEVEL and neighbors >= 5:
				result[index] = SEA_LEVEL + COAST_EPSILON
	return result


func _apply_topology(heights: PackedFloat32Array, cells: PackedByteArray) -> void:
	for index in range(cells.size()):
		if cells[index] == 1 and heights[index] <= SEA_LEVEL:
			heights[index] = SEA_LEVEL + COAST_EPSILON
		elif cells[index] == 0 and heights[index] > SEA_LEVEL:
			heights[index] = SEA_LEVEL + SHALLOW_LEVEL - COAST_EPSILON


func _condition_coast(heights: PackedFloat32Array, cells: PackedByteArray, world_seed: int) -> void:
	# The coast is a slope. Sheltered shores slope gently, so the band just above sea
	# level is wide (beach). Exposed shores slope steeply, so it is skipped (cliff).
	var distance := _coast_distance(cells)
	var rhythm := _noise(world_seed ^ 0x5bd1e995, 0.05 / RESOLUTION)
	# Measure steepness on the shoreline only, then carry it inland so each slope stays monotonic.
	var steepness := PackedFloat32Array()
	steepness.resize(cells.size())
	for ring in range(1, COAST_ZONE + 1):
		for index in range(cells.size()):
			if cells[index] != 1 or distance[index] != ring:
				continue
			var x := index % WIDTH
			var y := index / WIDTH
			if ring == 1:
				var exposure := smoothstep(0.36, 0.58, _water_fraction(cells, x, y))
				steepness[index] = clampf(exposure + rhythm.get_noise_2d(x, y) * 0.55, 0.0, 1.0)
				continue
			var total := 0.0
			var count := 0
			for dy in range(-1, 2):
				for dx in range(-1, 2):
					var neighbor := Vector2i(x + dx, y + dy)
					if _in_bounds(neighbor) and distance[neighbor.y * WIDTH + neighbor.x] == ring - 1 and cells[neighbor.y * WIDTH + neighbor.x] == 1:
						total += steepness[neighbor.y * WIDTH + neighbor.x]
						count += 1
			steepness[index] = total / maxi(count, 1)
		if ring == 1:
			_blur_shoreline(steepness, cells, distance)
	for y in range(HEIGHT):
		for x in range(WIDTH):
			var index := y * WIDTH + x
			var d := distance[index]
			var on_rim := x < BORDER or x >= WIDTH - BORDER or y < BORDER or y >= HEIGHT - BORDER
			if cells[index] == 1:
				if d > COAST_ZONE:
					heights[index] = maxf(heights[index], BEACH_LEVEL + 0.04)
					continue
				var slope := lerpf(GENTLE_SLOPE, STEEP_SLOPE, steepness[index])
				# Refinement adds inland samples without lowering the original cliff lip.
				var profile := maxf(SEA_LEVEL + COAST_EPSILON, (d + RESOLUTION - 1) * slope)
				var inland := maxf(heights[index], BEACH_LEVEL + 0.04)
				heights[index] = lerpf(profile, inland, smoothstep(3.0 * RESOLUTION, float(COAST_ZONE), d))
			elif on_rim or d > SHALLOW_ZONE:
				# Shallows belong to the coast. Nothing light-blue may drift offshore.
				heights[index] = minf(heights[index], SEA_LEVEL + SHALLOW_LEVEL - COAST_EPSILON)
			else:
				var shelter := 1.0 - smoothstep(0.55, 0.80, _water_fraction(cells, x, y))
				heights[index] = -d * lerpf(0.11, 0.06, shelter) / RESOLUTION


func _blur_shoreline(steepness: PackedFloat32Array, cells: PackedByteArray, distance: PackedInt32Array) -> void:
	# Average along the shore so beaches and cliffs come in runs, not single-tile speckles.
	var source := steepness.duplicate()
	for index in range(cells.size()):
		if cells[index] != 1 or distance[index] != 1:
			continue
		var x := index % WIDTH
		var y := index / WIDTH
		var total := 0.0
		var count := 0
		for dy in range(-2, 3):
			for dx in range(-2, 3):
				var neighbor := Vector2i(x + dx, y + dy)
				if not _in_bounds(neighbor):
					continue
				var next := neighbor.y * WIDTH + neighbor.x
				if cells[next] == 1 and distance[next] == 1:
					total += source[next]
					count += 1
		steepness[index] = total / count


func _coast_distance(cells: PackedByteArray) -> PackedInt32Array:
	# Chebyshev distance from each cell to the nearest cell of the opposite type.
	var distance := PackedInt32Array()
	distance.resize(cells.size())
	distance.fill(-1)
	var frontier := PackedInt32Array()
	for index in range(cells.size()):
		var x := index % WIDTH
		var y := index / WIDTH
		for dy in range(-1, 2):
			for dx in range(-1, 2):
				var neighbor := Vector2i(x + dx, y + dy)
				if _in_bounds(neighbor) and cells[neighbor.y * WIDTH + neighbor.x] != cells[index] and distance[index] == -1:
					distance[index] = 1
					frontier.append(index)
	var cursor := 0
	while cursor < frontier.size():
		var index := frontier[cursor]
		cursor += 1
		var cell := Vector2i(index % WIDTH, index / WIDTH)
		for dy in range(-1, 2):
			for dx in range(-1, 2):
				var neighbor := cell + Vector2i(dx, dy)
				if not _in_bounds(neighbor):
					continue
				var next := neighbor.y * WIDTH + neighbor.x
				if distance[next] == -1 and cells[next] == cells[index]:
					distance[next] = distance[index] + 1
					frontier.append(next)
	return distance


func _water_fraction(cells: PackedByteArray, x: int, y: int) -> float:
	# Low inside bays, high at headlands.
	var water := 0
	var total := 0
	for dy in range(-EXPOSURE_RADIUS, EXPOSURE_RADIUS + 1):
		for dx in range(-EXPOSURE_RADIUS, EXPOSURE_RADIUS + 1):
			if dx * dx + dy * dy > EXPOSURE_RADIUS * EXPOSURE_RADIUS:
				continue
			var neighbor := Vector2i(x + dx, y + dy)
			total += 1
			if not _in_bounds(neighbor) or cells[neighbor.y * WIDTH + neighbor.x] == 0:
				water += 1
	return float(water) / total


func _largest_region(cells: PackedByteArray) -> PackedByteArray:
	var visited := PackedByteArray()
	visited.resize(cells.size())
	var largest := PackedInt32Array()
	for start in range(cells.size()):
		if cells[start] == 0 or visited[start] == 1:
			continue
		var region := PackedInt32Array([start])
		visited[start] = 1
		var cursor := 0
		while cursor < region.size():
			var index := region[cursor]
			cursor += 1
			var cell := Vector2i(index % WIDTH, index / WIDTH)
			for direction: Vector2i in DIRECTIONS:
				var neighbor := cell + direction
				if not _in_bounds(neighbor):
					continue
				var next := neighbor.y * WIDTH + neighbor.x
				if cells[next] == 1 and visited[next] == 0:
					visited[next] = 1
					region.append(next)
		if region.size() > largest.size():
			largest = region
	var result := PackedByteArray()
	result.resize(cells.size())
	for index in largest:
		result[index] = 1
	return result


func _fill_lakes(cells: PackedByteArray) -> void:
	var ocean := PackedByteArray()
	ocean.resize(cells.size())
	var frontier := PackedInt32Array([0])
	ocean[0] = 1
	var cursor := 0
	while cursor < frontier.size():
		var index := frontier[cursor]
		cursor += 1
		var cell := Vector2i(index % WIDTH, index / WIDTH)
		# Eight-neighbor water complements four-neighbor land at diagonal corners.
		for dy in range(-1, 2):
			for dx in range(-1, 2):
				var neighbor := cell + Vector2i(dx, dy)
				if not _in_bounds(neighbor):
					continue
				var next := neighbor.y * WIDTH + neighbor.x
				if cells[next] == 0 and ocean[next] == 0:
					ocean[next] = 1
					frontier.append(next)
	for index in range(cells.size()):
		if cells[index] == 0 and ocean[index] == 0:
			cells[index] = 1


func _in_bounds(cell: Vector2i) -> bool:
	return cell.x >= 0 and cell.x < WIDTH and cell.y >= 0 and cell.y < HEIGHT
