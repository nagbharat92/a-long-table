extends Control

const Generator := preload("res://scripts/island_generator.gd")
const TerrainView := preload("res://scripts/terrain_view.gd")

var generator := Generator.new()
var terrain := TerrainView.new()
var camera := Camera2D.new()
var world: Dictionary = {}
var seed_label: Label
var status_label: Label
var overlay := PanelContainer.new()
var overlay_layer := CanvasLayer.new()
var fit_rect := Rect2()
var rng := RandomNumberGenerator.new()


func _ready() -> void:
	rng.randomize()
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(terrain)
	camera.position_smoothing_enabled = false
	add_child(camera)
	_build_interface()
	get_viewport().size_changed.connect(_resize_world)
	show_seed(42)
	_resize_world.call_deferred()
	for argument in OS.get_cmdline_user_args():
		if argument.begins_with("--preview-output="):
			_capture_preview.call_deferred(argument.trim_prefix("--preview-output="))


func show_seed(value: int) -> bool:
	var candidate := generator.generate(value)
	if candidate.is_empty():
		status_label.text = "Could not generate an island. Press R to try again."
		return false
	world = candidate
	terrain.set_world(world)
	status_label.text = "Island, beaches, shallows"
	seed_label.text = "Seed %06d  ·  Press R to refresh" % value
	_resize_world()
	return true


func _unhandled_key_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and not event.echo:
		if event.keycode == KEY_R and not event.ctrl_pressed and not event.meta_pressed and not event.alt_pressed:
			_refresh()
			get_viewport().set_input_as_handled()


func _refresh() -> void:
	var next_seed := (int(world.get("seed", 0)) + rng.randi_range(1, 999999)) % 1000000
	show_seed(next_seed)


func _resize_world() -> void:
	if world.is_empty():
		return
	var view_size := get_viewport_rect().size
	var density := _display_density()
	overlay_layer.scale = Vector2.ONE * density
	overlay.position = Vector2(14, 12)
	overlay.custom_minimum_size.x = 0
	overlay.size = overlay.get_combined_minimum_size()
	var margin := minf(48.0 * density, minf(view_size.x, view_size.y) * 0.07)
	var bounds := terrain.get_island_bounds()
	fit_rect = Rect2(Vector2.ONE * margin, view_size - Vector2.ONE * margin * 2.0)
	var zoom_level := _fit_zoom(bounds, fit_rect)
	var hud := Rect2(overlay.position * density, overlay.size * density).grow(12.0 * density)
	var centered_island := Rect2(
		fit_rect.get_center() - bounds.size * zoom_level * 0.5,
		bounds.size * zoom_level
	)
	if centered_island.intersects(hud):
		var below := Rect2(
			Vector2(margin, hud.end.y),
			Vector2(view_size.x - margin * 2.0, view_size.y - hud.end.y - margin)
		)
		var beside := Rect2(
			Vector2(hud.end.x, margin),
			Vector2(view_size.x - hud.end.x - margin, view_size.y - margin * 2.0)
		)
		fit_rect = beside if _fit_zoom(bounds, beside) > _fit_zoom(bounds, below) else below
		zoom_level = _fit_zoom(bounds, fit_rect)
	camera.zoom = Vector2.ONE * zoom_level
	camera.position = bounds.get_center()
	# Center the island without hiding it under the HUD, on exact screen pixels.
	var screen_center := fit_rect.get_center().floor()
	camera.offset = (view_size * 0.5 - screen_center) / zoom_level
	camera.force_update_scroll()
	var visible := Rect2(
		camera.position + camera.offset - view_size / camera.zoom * 0.5,
		view_size / camera.zoom
	)
	terrain.set_ocean_rect(visible)


func _fit_zoom(bounds: Rect2, area: Rect2) -> int:
	return maxi(1, int(floorf(minf(area.size.x / bounds.size.x, area.size.y / bounds.size.y))))


func _display_density() -> float:
	if OS.has_feature("web"):
		return maxf(1.0, float(JavaScriptBridge.eval("window.devicePixelRatio")))
	return 1.0


func _build_interface() -> void:
	var ui_theme := Theme.new()
	var font := SystemFont.new()
	font.font_names = PackedStringArray(["Arial", "Helvetica Neue"])
	ui_theme.default_font = font
	ui_theme.default_font_size = 12
	add_child(overlay_layer)
	overlay.theme = ui_theme
	overlay.mouse_filter = Control.MOUSE_FILTER_IGNORE
	overlay.add_theme_stylebox_override("panel", StyleBoxEmpty.new())
	overlay_layer.add_child(overlay)
	var content := VBoxContainer.new()
	content.add_theme_constant_override("separation", 2)
	overlay.add_child(content)
	status_label = _label("", 12, Color("#ffffffe6"))
	content.add_child(status_label)
	seed_label = _label("", 12, Color("#ffffffa6"))
	content.add_child(seed_label)
	overlay.minimum_size_changed.connect(_resize_world)


func _label(text: String, font_size: int, color: Color) -> Label:
	var label := Label.new()
	label.text = text
	label.add_theme_font_size_override("font_size", font_size)
	label.add_theme_color_override("font_color", color)
	# Soft shadow keeps white text readable over sand and grass without a panel.
	label.add_theme_color_override("font_shadow_color", Color("#0b3d6640"))
	label.add_theme_constant_override("shadow_offset_x", 0)
	label.add_theme_constant_override("shadow_offset_y", 1)
	label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return label


func _capture_preview(path: String) -> void:
	await RenderingServer.frame_post_draw
	var error := get_viewport().get_texture().get_image().save_png(path)
	if error != OK:
		push_error("Could not save preview: %s" % error_string(error))
	else:
		print("Preview saved: %s" % path)
