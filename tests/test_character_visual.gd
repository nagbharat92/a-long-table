extends SceneTree

const Character := preload("res://scripts/character.gd")
const Appearance := preload("res://scripts/character_visual.gd")
const Lab := preload("res://character_lab.tscn")

var failures := 0


func _initialize() -> void:
	_run.call_deferred()


func _run() -> void:
	var character := Character.new()
	character.position = Vector2(64, 64)
	character.set_process(false)
	root.add_child(character)
	var visual = character.appearance
	var ground_position := character.position
	visual.advance(0.2, Appearance.HOP_DISTANCE * 0.5, Vector2.RIGHT, true)
	_check(visual.hop_height > 1.8, "The hop visibly lifts the whole body at its apex.")
	_check(visual.body.position.y < -1.8, "Hop height is applied to the visual rig.")
	_check(character.position == ground_position, "Bouncing never moves the ground position.")
	var apex_y: float = visual.body.position.y
	visual.advance(0.2, Appearance.HOP_DISTANCE * 0.5, Vector2.RIGHT, true)
	_check(absf(visual.body.position.y) < 0.001, "The character lands every stride.")
	_check(visual.body.scale.y < 0.9 and visual.body.scale.x > 1.1, "Landing has a small squash.")
	_check(apex_y < visual.body.position.y, "The hop has distinct raised and grounded poses.")
	for zoom in [0.5, 1.0, 2.0, 8.0]:
		var radius := maxf(1.5, 3.0 / zoom)
		_check(character.marker_position(zoom).y + radius < visual.get_visual_bounds().position.y, "The marker stays above the ears at zoom %.1f." % zoom)
		_check(character.hit_test(character.position + character.marker_position(zoom), zoom), "The floating marker remains selectable.")
	var ear_tip: Vector2 = visual.left_ear.global_transform * Vector2(0, -2.8)
	_check(character.hit_test(ear_tip, 8.0), "Clicking an ear selects the character at close zoom.")
	var distance: float = visual.gait_distance
	visual.advance(1.0, 0.0, Vector2.ZERO, false)
	_check(visual.gait_distance == distance, "Idle does not advance the stride.")
	_check(visual.hop_height < 0.001 and visual.motion_weight < 0.001, "Stopping settles to a quiet idle.")
	var fast := Appearance.new()
	var slow := Appearance.new()
	for frame in range(60):
		fast.advance(1.0 / 60, Character.MOVE_SPEED / 60, Vector2.RIGHT, true)
		slow.advance(1.0 / 60, Character.MOVE_SPEED * 0.45 / 60, Vector2.RIGHT, true)
	_check(is_equal_approx(slow.gait_distance / fast.gait_distance, 0.45), "Shallows slow the hop cadence with actual travel distance.")
	var low_rate := Appearance.new()
	for frame in range(30):
		low_rate.advance(1.0 / 30, Character.MOVE_SPEED / 30, Vector2.RIGHT, true)
	_check(absf(low_rate.hop_height - fast.hop_height) < 0.001, "Hop timing is independent of frame rate.")
	fast.free()
	slow.free()
	low_rate.free()
	character.free()
	root.size = Vector2i(1200, 850)
	var lab := Lab.instantiate()
	root.add_child(lab)
	lab.set_process(false)
	for mode in [0, 1, 2]:
		lab.set_mode(mode)
		for index in range(3):
			_check(lab.buttons[index].button_pressed == (index == mode), "Exactly one playground mode appears active.")
		_check(lab.appearance.get_script() == Appearance, "The playground uses the real game rig.")
	for window_size in [Vector2i(1200, 850), Vector2i(390, 844), Vector2i(320, 568), Vector2i(240, 240)]:
		root.size = window_size
		await process_frame
		await process_frame
		var bounds: Rect2 = lab.appearance.transform * lab.appearance.get_visual_bounds()
		var heading_bottom: float = lab.heading.position.y + lab.heading.size.y
		_check(bounds.position.y > heading_bottom and bounds.end.y < lab.footer.position.y, "The character clears the controls and footer at %s." % window_size)
		_check(Rect2(Vector2.ZERO, Vector2(window_size)).encloses(bounds), "The playground character fits at %s." % window_size)
	root.size = Vector2i(1200, 850)
	await process_frame
	await process_frame
	var directory := ""
	for argument in OS.get_cmdline_user_args():
		if argument.begins_with("--capture-dir="):
			directory = argument.trim_prefix("--capture-dir=")
	if not directory.is_empty():
		for state in ["idle", "apex", "landing"]:
			lab.set_mode(0 if state == "idle" else 1)
			lab.appearance.gait_distance = 0.0
			lab.appearance.motion_weight = 0.0
			lab.appearance.advance(1.0, 0.0, Vector2.ZERO, false)
			if state != "idle":
				lab.appearance.advance(0.2, Appearance.HOP_DISTANCE * (0.5 if state == "apex" else 1.0), Vector2.RIGHT, true)
			await process_frame
			await RenderingServer.frame_post_draw
			var error := root.get_texture().get_image().save_png(directory.path_join("bunny-%s.png" % state))
			_check(error == OK, "Character preview saves successfully.")
	if failures == 0:
		print("PASS: hop height, landing squash, grounded position, quiet idle, speed-linked cadence, frame-rate independence, ear/marker selection and shared playground rig.")
	quit(1 if failures else 0)


func _check(condition: bool, message: String) -> void:
	if not condition:
		failures += 1
		push_error(message)
