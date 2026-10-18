extends SceneTree

const Generator := preload("res://scripts/island_generator.gd")
const TerrainView := preload("res://scripts/terrain_view.gd")
const SEEDS := [719633, 829942, 534481, 42, 915833, 271828]


func _initialize() -> void:
	_capture.call_deferred()


func _capture() -> void:
	root.content_scale_size = Vector2i(1600, 760)
	root.size = Vector2i(1600, 760)
	var background := ColorRect.new()
	background.color = Color("#f4f3ed")
	background.size = Vector2(1600, 760)
	root.add_child(background)
	var generator := Generator.new()
	for index in range(SEEDS.size()):
		var world := generator.generate(SEEDS[index])
		if world.is_empty():
			quit(1)
			return
		var point := Vector2(24 + (index % 3) * 524, 20 + (index / 3) * 370)
		var label := Label.new()
		label.position = point
		label.text = "Seed %06d" % SEEDS[index]
		label.add_theme_color_override("font_color", Color("#24382e"))
		label.add_theme_font_size_override("font_size", 18)
		root.add_child(label)
		var container := SubViewportContainer.new()
		container.position = point + Vector2(0, 36)
		container.size = Vector2(497, 288)
		root.add_child(container)
		var viewport := SubViewport.new()
		viewport.size = Vector2i(497, 288)
		viewport.render_target_update_mode = SubViewport.UPDATE_ALWAYS
		container.add_child(viewport)
		var terrain := TerrainView.new()
		terrain.set_world(world)
		viewport.add_child(terrain)
		var camera := Camera2D.new()
		var bounds := terrain.get_island_bounds()
		var fit := minf(473.0 / bounds.size.x, 264.0 / bounds.size.y)
		var zoom := floorf(fit) if fit >= 1.0 else 1.0 / ceilf(1.0 / fit)
		camera.zoom = Vector2.ONE * zoom
		camera.position = bounds.get_center()
		viewport.add_child(camera)
		var visible_size := Vector2(viewport.size) / camera.zoom
		terrain.set_ocean_rect(Rect2(camera.position - visible_size * 0.5, visible_size))
	var arguments := OS.get_cmdline_user_args()
	if arguments.size() != 1:
		push_error("Pass exactly one output PNG path.")
		quit(1)
		return
	await process_frame
	await RenderingServer.frame_post_draw
	var error := root.get_texture().get_image().save_png(arguments[0])
	if error != OK:
		push_error("Could not save island comparison: %s" % error_string(error))
		quit(1)
		return
	print("Saved six-seed comparison: %s" % arguments[0])
	quit(0)
