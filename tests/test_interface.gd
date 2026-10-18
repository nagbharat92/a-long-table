extends SceneTree

const MainScene := preload("res://main.tscn")


func _initialize() -> void:
	_run.call_deferred()


func _run() -> void:
	var scene := MainScene.instantiate()
	root.add_child(scene)
	await process_frame
	await RenderingServer.frame_post_draw
	var original_cells: PackedByteArray = scene.world["cells"].duplicate()
	var original_heights: PackedFloat32Array = scene.world["heights"].duplicate()
	var original_seed: int = scene.world["seed"]
	var before_path := _argument("--before=")
	if not before_path.is_empty():
		await RenderingServer.frame_post_draw
		if not _save_image(before_path):
			quit(1)
			return
	var shortcut := InputEventKey.new()
	shortcut.keycode = KEY_R
	shortcut.pressed = true
	Input.parse_input_event(shortcut)
	await process_frame
	await process_frame
	if scene.world["seed"] == original_seed or scene.world["cells"] == original_cells:
		push_error("R did not regenerate the island.")
		quit(1)
		return
	if not scene.seed_label.text.begins_with("Seed %06d" % scene.world["seed"]):
		push_error("Seed readout does not match the displayed world.")
		quit(1)
		return
	shortcut.pressed = false
	Input.parse_input_event(shortcut)
	var after_path := _argument("--after=")
	if not after_path.is_empty():
		await RenderingServer.frame_post_draw
		if not _save_image(after_path):
			quit(1)
			return
	if not scene.show_seed(original_seed) or scene.world["cells"] != original_cells or scene.world["heights"] != original_heights:
		push_error("Returning to the original seed did not restore the original terrain.")
		quit(1)
		return
	for window_size in [
		Vector2i(1440, 900), Vector2i(800, 600), Vector2i(390, 844),
		Vector2i(320, 568), Vector2i(2560, 1440), Vector2i(844, 390),
	]:
		root.size = window_size
		await process_frame
		await process_frame
		await RenderingServer.frame_post_draw
		var zoom: Vector2 = scene.camera.zoom
		if zoom.x < 1.0 or zoom.x != floorf(zoom.x) or zoom.x != zoom.y:
			push_error("Camera zoom must be a positive whole number at %s." % window_size)
			quit(1)
			return
		var transform := root.get_canvas_transform()
		var island: Rect2 = transform * scene.terrain.get_island_bounds()
		if not scene.fit_rect.grow(1.0).encloses(island):
			push_error("The island and its margin do not fit at %s: %s / %s." % [window_size, island, scene.fit_rect])
			quit(1)
			return
		if not transform.origin.is_equal_approx(transform.origin.round()):
			push_error("Camera translation must land on whole pixels.")
			quit(1)
			return
		var visible := Rect2(transform.affine_inverse() * Vector2.ZERO, Vector2(root.size) / zoom)
		if not scene.terrain.ocean_rect.encloses(visible):
			push_error("Ocean does not fill viewport at %s." % window_size)
			quit(1)
			return
		var overlay: Rect2 = scene.overlay.get_global_rect()
		if not Rect2(Vector2.ZERO, Vector2(root.size)).encloses(overlay):
			push_error("Overlay clips outside viewport at %s: %s." % [window_size, overlay])
			quit(1)
			return
		if island.intersects(overlay):
			push_error("Overlay covers the island at %s." % window_size)
			quit(1)
			return
		if scene.world["cells"] != original_cells or scene.world["heights"] != original_heights:
			push_error("Resizing changed generated terrain.")
			quit(1)
			return
		print("PASS: %s fits at integer zoom %d with ocean and overlay." % [window_size, int(zoom.x)])
	for value in [719633, 829942, 534481, 915833, 934742, 271828]:
		scene.show_seed(value)
		for window_size in [Vector2i(320, 568), Vector2i(1440, 900)]:
			root.size = window_size
			await process_frame
			await process_frame
			var island: Rect2 = root.get_canvas_transform() * scene.terrain.get_island_bounds()
			if not scene.fit_rect.grow(1.0).encloses(island) or island.intersects(scene.overlay.get_global_rect()):
				push_error("Seed %d does not fit without HUD overlap at %s." % [value, window_size])
				quit(1)
				return
	print("PASS: R regenerates; seed restores terrain; all resize scenarios preserve it.")
	quit(0)


func _save_image(path: String) -> bool:
	var error := root.get_texture().get_image().save_png(path)
	if error != OK:
		push_error("Could not save interface capture: %s" % error_string(error))
		return false
	return true


func _argument(prefix: String) -> String:
	for argument in OS.get_cmdline_user_args():
		if argument.begins_with(prefix):
			return argument.trim_prefix(prefix)
	return ""
