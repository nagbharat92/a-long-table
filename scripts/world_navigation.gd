extends RefCounted

const Generator := preload("res://scripts/island_generator.gd")
const Rules := preload("res://scripts/terrain_rules.gd")
const SHALLOW_SPEED := 0.45
const CLEARANCE := 0.75

var graph := AStar2D.new()
var heights := PackedFloat32Array()
var speeds := PackedFloat32Array()
var components := PackedInt32Array()


func set_world(world: Dictionary) -> void:
	heights = world["heights"]
	graph.clear()
	speeds.resize(heights.size())
	speeds.fill(0.0)
	components.resize(heights.size())
	components.fill(-1)
	for index in range(heights.size()):
		if heights[index] > Generator.SEA_LEVEL:
			speeds[index] = 1.0
		elif heights[index] > Generator.SHALLOW_LEVEL:
			speeds[index] = SHALLOW_SPEED
	# The renderer projects south-facing cliff faces over the coastal shelf.
	for index in range(heights.size()):
		var cell := _cell(index)
		if Rules.is_cliff(heights, cell):
			for depth in range(1, ceili(float(Rules.CLIFF_DEPTH) / Rules.TILE_SIZE) + 1):
				var below := cell + Vector2i(0, depth)
				if Rules.in_bounds(below) and not Rules.is_land(heights, below):
					speeds[_id(below)] = 0.0
	for index in range(speeds.size()):
		if speeds[index] > 0.0:
			graph.add_point(index, Rules.cell_center(_cell(index)), 1.0 / speeds[index])
	for index in graph.get_point_ids():
		var cell := _cell(index)
		for offset in [Vector2i.RIGHT, Vector2i.DOWN, Vector2i(1, 1), Vector2i(-1, 1)]:
			var next: Vector2i = cell + offset
			if can_step(cell, next):
				graph.connect_points(index, _id(next))
	var component := 0
	for index in graph.get_point_ids():
		if components[index] != -1:
			continue
		var frontier := PackedInt64Array([index])
		components[index] = component
		var cursor := 0
		while cursor < frontier.size():
			var current := frontier[cursor]
			cursor += 1
			for neighbor in graph.get_point_connections(current):
				if components[neighbor] == -1:
					components[neighbor] = component
					frontier.append(neighbor)
		component += 1


func spawn_position() -> Vector2:
	var center := Vector2(Generator.WIDTH, Generator.HEIGHT) * Rules.TILE_SIZE * 0.5
	var best := Vector2.ZERO
	var distance := INF
	for index in graph.get_point_ids():
		if not Rules.is_grass(heights, _cell(index)):
			continue
		var point := graph.get_point_position(index)
		var candidate := point.distance_squared_to(center)
		if candidate < distance:
			distance = candidate
			best = point
	return best


func speed_at(point: Vector2) -> float:
	var cell := Rules.world_cell(point)
	return speeds[_id(cell)] if Rules.in_bounds(cell) else 0.0


func can_step(from: Vector2i, to: Vector2i) -> bool:
	if not _open(from) or not _open(to):
		return false
	var delta := to - from
	if absi(delta.x) > 1 or absi(delta.y) > 1:
		return false
	if delta.x != 0 and delta.y != 0:
		var horizontal := from + Vector2i(delta.x, 0)
		var vertical := from + Vector2i(0, delta.y)
		return (
			can_step(from, horizontal) and can_step(from, vertical)
			and can_step(horizontal, to) and can_step(vertical, to)
		)
	# Raised grass cannot be entered or left through its cliff edge.
	if Rules.is_land(heights, from) != Rules.is_land(heights, to):
		return not Rules.is_grass(heights, from) and not Rules.is_grass(heights, to)
	return true


func route(from: Vector2, requested: Vector2) -> PackedVector2Array:
	var start := Rules.world_cell(from)
	if not _open(start):
		push_error("Cannot route a character outside walkable terrain.")
		return PackedVector2Array()
	var component := components[_id(start)]
	var target := from
	var best_distance := INF
	var target_id := _id(start)
	var requested_cell := Rules.world_cell(requested)
	if _open(requested_cell) and components[_id(requested_cell)] == component and segment_clear(requested, requested):
		target = requested
		target_id = _id(requested_cell)
	else:
		for index in graph.get_point_ids():
			if components[index] != component:
				continue
			var candidate := _closest_in_cell(_cell(index), requested)
			var distance := candidate.distance_squared_to(requested)
			if distance < best_distance:
				best_distance = distance
				target = candidate
				target_id = index
	var cells := graph.get_id_path(_id(start), target_id)
	var points := PackedVector2Array([from])
	for index in cells:
		points.append(graph.get_point_position(index))
	points.append(target)
	# Drop only safe, same-speed shortcuts so shallows retain their route cost.
	var result := PackedVector2Array([from])
	var anchor := 0
	while anchor < points.size() - 1:
		var next := anchor + 1
		for candidate in range(anchor + 2, points.size()):
			if not segment_clear(points[anchor], points[candidate], true):
				break
			next = candidate
		if not result[-1].is_equal_approx(points[next]):
			result.append(points[next])
		anchor = next
	return result


func segment_clear(from: Vector2, to: Vector2, same_speed := false) -> bool:
	if not _trace_clear(from, to, same_speed):
		return false
	for dy in range(-1, 2):
		for dx in range(-1, 2):
			if dx == 0 and dy == 0:
				continue
			var offset := Vector2(dx, dy) * (CLEARANCE - 0.001)
			if not can_step(Rules.world_cell(from), Rules.world_cell(from + offset)):
				return false
			if not can_step(Rules.world_cell(to), Rules.world_cell(to + offset)):
				return false
			if not _trace_clear(from + offset, to + offset):
				return false
	return true


func _trace_clear(from: Vector2, to: Vector2, same_speed := false) -> bool:
	var cell := Rules.world_cell(from)
	var end := Rules.world_cell(to)
	if not _open(cell) or not _open(end):
		return false
	var speed := speeds[_id(cell)]
	var direction := to - from
	var step := Vector2i(signf(direction.x), signf(direction.y))
	var interval := Vector2(
		Rules.TILE_SIZE / absf(direction.x) if step.x != 0 else INF,
		Rules.TILE_SIZE / absf(direction.y) if step.y != 0 else INF
	)
	var boundary := Vector2(cell + Vector2i(int(step.x > 0), int(step.y > 0))) * Rules.TILE_SIZE
	var crossing := Vector2(
		(boundary.x - from.x) / direction.x if step.x != 0 else INF,
		(boundary.y - from.y) / direction.y if step.y != 0 else INF
	)
	# Visit every crossed cell exactly; fixed-distance samples can miss narrow corners.
	while cell != end:
		var next := cell
		if is_equal_approx(crossing.x, crossing.y):
			next += step
			crossing += interval
		elif crossing.x < crossing.y:
			next.x += step.x
			crossing.x += interval.x
		else:
			next.y += step.y
			crossing.y += interval.y
		if not can_step(cell, next):
			return false
		if same_speed and not is_equal_approx(speeds[_id(next)], speed):
			return false
		cell = next
	return true


func _closest_in_cell(cell: Vector2i, requested: Vector2) -> Vector2:
	var minimum := Vector2(cell) * Rules.TILE_SIZE
	var maximum := minimum + Vector2.ONE * Rules.TILE_SIZE
	var low := minimum + Vector2(
		0.0 if can_step(cell, cell + Vector2i.LEFT) else CLEARANCE,
		0.0 if can_step(cell, cell + Vector2i.UP) else CLEARANCE
	)
	var high := maximum - Vector2(
		0.0 if can_step(cell, cell + Vector2i.RIGHT) else CLEARANCE,
		0.0 if can_step(cell, cell + Vector2i.DOWN) else CLEARANCE
	)
	var candidate := requested.clamp(low, high)
	if segment_clear(candidate, candidate):
		return candidate
	# Only a blocked diagonal corner can remain after the cardinal insets.
	var best := requested.clamp(minimum + Vector2.ONE * CLEARANCE, maximum - Vector2.ONE * CLEARANCE)
	var distance := best.distance_squared_to(requested)
	for alternative in [
		Vector2(minimum.x + CLEARANCE, candidate.y),
		Vector2(maximum.x - CLEARANCE, candidate.y),
		Vector2(candidate.x, minimum.y + CLEARANCE),
		Vector2(candidate.x, maximum.y - CLEARANCE),
	]:
		var next_distance := requested.distance_squared_to(alternative)
		if next_distance < distance and segment_clear(alternative, alternative):
			best = alternative
			distance = next_distance
	return best


func _open(cell: Vector2i) -> bool:
	return Rules.in_bounds(cell) and speeds[_id(cell)] > 0.0


func _id(cell: Vector2i) -> int:
	return cell.y * Generator.WIDTH + cell.x


func _cell(index: int) -> Vector2i:
	return Vector2i(index % Generator.WIDTH, index / Generator.WIDTH)
