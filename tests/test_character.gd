extends SceneTree

const Generator := preload("res://scripts/island_generator.gd")
const Rules := preload("res://scripts/terrain_rules.gd")
const Navigation := preload("res://scripts/world_navigation.gd")
const Character := preload("res://scripts/character.gd")
const Selection := preload("res://scripts/selection_controller.gd")

var failures := 0


func _initialize() -> void:
	_run.call_deferred()


func _run() -> void:
	_check_routes()
	_check_terrain()
	_check_movement_and_selection()
	_check_generated_worlds()
	if failures == 0:
		print("PASS: obstacle routes, nearest reachable destinations, cliff edges, water costs, continuous movement, independent characters and selection.")
	quit(1 if failures else 0)


func _fixture(rect: Rect2i, height := 0.08) -> Dictionary:
	var heights := PackedFloat32Array()
	heights.resize(Generator.WIDTH * Generator.HEIGHT)
	heights.fill(-1.0)
	for y in range(rect.position.y, rect.end.y):
		for x in range(rect.position.x, rect.end.x):
			heights[y * Generator.WIDTH + x] = height
	return {"heights": heights}


func _put(world: Dictionary, cell: Vector2i, height: float) -> void:
	world["heights"][cell.y * Generator.WIDTH + cell.x] = height


func _check_routes() -> void:
	var world := _fixture(Rect2i(10, 10, 20, 20))
	for y in range(10, 27):
		_put(world, Vector2i(20, y), -1.0)
	var nav := Navigation.new()
	nav.set_world(world)
	var start := Rules.cell_center(Vector2i(15, 15))
	var target := Rules.cell_center(Vector2i(25, 15)) + Vector2(0.6, -0.4)
	var route := nav.route(start, target)
	_check(route.size() >= 4, "Route detours around the obstacle.")
	_check(route[-1].is_equal_approx(target), "Walkable destinations retain sub-tile precision.")
	_check_route(nav, route)
	var off_map := Vector2(-100, -100)
	var nearest := nav.route(start, off_map)
	_check(nearest[-1].is_equal_approx(Vector2(40.75, 40.75)), "Off-map clicks choose nearest reachable boundary with character clearance.")
	_check_route(nav, nearest)
	for y in range(10, 30):
		_put(world, Vector2i(20, y), -1.0)
	nav.set_world(world)
	var unreachable := nav.route(start, target)
	_check(unreachable[-1].x < 80.0, "Disconnected walkable targets resolve within the source component.")
	_check(is_equal_approx(unreachable[-1].x, 79.25), "Unreachable targets use the nearest reachable point, not the nearest target-side cell.")
	_check_route(nav, unreachable)
	var seam_unreachable := nav.route(start, Vector2(100, 64))
	_check(seam_unreachable[-1].is_equal_approx(Vector2(79.25, 64)), "Nearest boundary targets preserve the exact tangential position across open tile seams.")
	_check_route(nav, seam_unreachable)
	var tiny_move := nav.route(start + Vector2(0.2, 0.1), start + Vector2(0.9, -0.2))
	_check(tiny_move.size() == 2, "Same-cell movement is direct, without a center detour.")
	var seam_target := Vector2(60, 64)
	var seam_route := nav.route(start, seam_target)
	_check(seam_route[-1].is_equal_approx(seam_target), "Open tile seams and corners retain the exact clicked position.")
	_check_route(nav, seam_route)
	_check(not nav.can_step(Vector2i(19, 15), Vector2i(20, 16)), "Diagonal movement cannot cut blocked corners.")
	world = _fixture(Rect2i(10, 10, 20, 20))
	_put(world, Vector2i(20, 20), -1.0)
	nav.set_world(world)
	var corner_start := Vector2(78.6, 80.05)
	var corner_end := Vector2(80.05, 78.6)
	_check(nav.segment_clear(corner_start, corner_start) and nav.segment_clear(corner_end, corner_end), "Corner regression endpoints have clearance.")
	_check(not nav.segment_clear(corner_start, corner_end), "Swept clearance detects narrow corner clips between valid endpoints.")


func _check_terrain() -> void:
	var world := _fixture(Rect2i(10, 10, 20, 10))
	for y in range(10, 20):
		for x in range(18, 21):
			_put(world, Vector2i(x, y), -0.1)
	var nav := Navigation.new()
	nav.set_world(world)
	var normal := Rules.cell_center(Vector2i(15, 15))
	var shallow := Rules.cell_center(Vector2i(19, 15))
	_check(nav.speed_at(normal) == 1.0, "Sand uses normal speed.")
	_check(is_equal_approx(nav.speed_at(shallow), Navigation.SHALLOW_SPEED), "Shallows use slower speed.")
	_check(nav.speed_at(Vector2.ZERO) == 0.0, "Deep water is blocked.")
	_check(nav.can_step(Vector2i(17, 15), Vector2i(18, 15)), "Beach entry to shallows is open.")
	var route := nav.route(normal, Rules.cell_center(Vector2i(25, 15)))
	_check_route(nav, route)
	_put(world, Vector2i(17, 15), 0.5)
	_put(world, Vector2i(19, 14), 0.5)
	nav.set_world(world)
	_check(nav.speed_at(normal) == 1.0, "Normal terrain speed remains unchanged.")
	_check(not nav.can_step(Vector2i(17, 15), Vector2i(18, 15)), "East-facing grass-to-water cliffs block movement.")
	_check(not nav.can_step(Vector2i(18, 15), Vector2i(17, 15)), "Cliff transitions are blocked in both directions.")
	_check(nav.speed_at(shallow) == 0.0, "South-facing cliff projection is blocked.")
	_check(Rules.is_cliff(world["heights"], Vector2i(19, 14)), "Cliff collision uses the rendering rule.")
	# A short shallow crossing costs more than the nearby dry detour.
	world = _fixture(Rect2i(10, 10, 20, 9))
	for x in range(16, 24):
		_put(world, Vector2i(x, 14), -0.1)
	nav.set_world(world)
	var weighted := nav.route(Rules.cell_center(Vector2i(14, 14)), Rules.cell_center(Vector2i(25, 14)))
	var crossed_water := false
	for index in range(1, weighted.size()):
		var steps := ceili(weighted[index - 1].distance_to(weighted[index]) / 0.5)
		for step in range(steps + 1):
			if nav.speed_at(weighted[index - 1].lerp(weighted[index], float(step) / maxi(steps, 1))) < 1.0:
				crossed_water = true
	_check(not crossed_water, "Weighted pathfinding prefers a faster dry detour.")
	_check_route(nav, weighted)


func _check_movement_and_selection() -> void:
	var world := _fixture(Rect2i(10, 10, 30, 20))
	for y in range(10, 30):
		for x in range(28, 40):
			_put(world, Vector2i(x, y), -0.1)
	var nav := Navigation.new()
	nav.set_world(world)
	var first := Character.new()
	var second := Character.new()
	first.navigation = nav
	second.navigation = nav
	first.position = Rules.cell_center(Vector2i(12, 15))
	second.position = Rules.cell_center(Vector2i(12, 22))
	var selection := Selection.new()
	selection.add_character(first)
	selection.add_character(second)
	selection.click(Rules.cell_center(Vector2i(24, 15)), 2.0)
	_check(not first.is_moving() and not second.is_moving(), "Ground clicks without selection do not command units.")
	selection.click(first.position, 2.0)
	_check(first.selected and not second.selected and selection.selected == [first], "Clicking a character selects only that character.")
	var target := Rules.cell_center(Vector2i(25, 15))
	selection.click(target, 2.0)
	_check(first.is_moving() and not second.is_moving(), "Commands apply only to selected characters.")
	var before := first.position
	first.advance(0.1)
	_check(is_equal_approx(first.position.distance_to(before), Character.MOVE_SPEED * 0.1), "Motion advances continuously at elapsed-time speed.")
	_check(is_equal_approx(first.appearance.gait_distance, Character.MOVE_SPEED * 0.1), "Animation receives actual distance travelled.")
	_check(not first.position.is_equal_approx(Rules.cell_center(Rules.world_cell(first.position))), "Movement is not tile-stepped.")
	var shallow_unit := Character.new()
	shallow_unit.navigation = nav
	shallow_unit.position = Rules.cell_center(Vector2i(30, 15))
	shallow_unit.move_to(Rules.cell_center(Vector2i(38, 15)))
	before = shallow_unit.position
	shallow_unit.advance(0.1)
	_check(is_equal_approx(shallow_unit.position.distance_to(before), Character.MOVE_SPEED * Navigation.SHALLOW_SPEED * 0.1), "Continuous movement actually slows in shallows.")
	_check(is_equal_approx(shallow_unit.appearance.gait_distance / first.appearance.gait_distance, Navigation.SHALLOW_SPEED), "Shallow terrain slows the animation cadence, not just the ground position.")
	selection.click(second.position, 2.0)
	_check(not first.selected and second.selected and first.is_moving(), "Changing selection does not interrupt another character's route.")
	for step in range(1000):
		first.advance(0.016)
		if not first.is_moving():
			break
	_check(first.position.is_equal_approx(target) and first.route.is_empty(), "Arrival is exact and clears the planned route.")
	first.move_to(Rules.cell_center(Vector2i(14, 15)))
	first.advance(0.2)
	first.move_to(target + Vector2(0.5, 0.5))
	for step in range(1000):
		first.advance(0.016)
		if not first.is_moving():
			break
	_check(first.position.is_equal_approx(target + Vector2(0.5, 0.5)), "Mid-route commands replace the destination.")
	selection.select_characters([first, second])
	selection.click(Rules.cell_center(Vector2i(20, 20)), 2.0)
	_check(first.is_moving() and second.is_moving(), "Selection and command APIs support groups without spawning extra units in the game.")
	first.free()
	second.free()
	shallow_unit.free()
	selection.free()


func _check_generated_worlds() -> void:
	var generator := Generator.new()
	for seed_value in [42, 43, 915833, 719633, 271828]:
		var world := generator.generate(seed_value)
		var nav := Navigation.new()
		nav.set_world(world)
		var start := nav.spawn_position()
		_check(nav.speed_at(start) == 1.0, "Generated characters spawn on dry ground.")
		var rng := RandomNumberGenerator.new()
		rng.seed = seed_value
		for attempt in range(15):
			var target := Vector2(rng.randf_range(-20, 532), rng.randf_range(-20, 404))
			var route := nav.route(start, target)
			_check_route(nav, route)
			var character := Character.new()
			character.navigation = nav
			character.position = start
			character.move_to(target)
			for step in range(4000):
				var previous := character.position
				var previous_index := character.route_index
				character.advance(0.05)
				_check(nav.segment_clear(previous, character.position), "Movement %s -> %s stays clear, waypoint %d -> %d." % [previous, character.position, previous_index, character.route_index])
				if not character.is_moving():
					break
			_check(not character.is_moving(), "Generated route arrives without getting stuck.")
			_check(character.position.is_equal_approx(route[-1]), "Generated route reaches its resolved destination.")
			character.free()


func _check_route(nav: RefCounted, route: PackedVector2Array) -> void:
	_check(not route.is_empty(), "Reachable route exists.")
	for index in range(1, route.size()):
		_check(nav.segment_clear(route[index - 1], route[index]), "Route segment %s -> %s respects terrain, clearance and cliffs." % [route[index - 1], route[index]])


func _check(condition: bool, message: String) -> void:
	if not condition:
		failures += 1
		push_error(message)
