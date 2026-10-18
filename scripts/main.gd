extends Control

const Generator := preload("res://scripts/island_generator.gd")
const TerrainView := preload("res://scripts/terrain_view.gd")
const Navigation := preload("res://scripts/world_navigation.gd")
const Character := preload("res://scripts/character.gd")
const SelectionController := preload("res://scripts/selection_controller.gd")

var generator := Generator.new()
var terrain: TerrainView
var camera: Camera2D
var world: Dictionary = {}
var seed_label: Label
var status_label: Label
var overlay: PanelContainer
var overlay_layer: CanvasLayer
var fit_rect := Rect2()
var rng := RandomNumberGenerator.new()
var navigation := Navigation.new()
var selection: SelectionController
var character_layer: Node2D
var zoom_factor := 1.0
var base_zoom := 1.0
var zoom_in: Button
var zoom_out: Button
var fit_button: Button


func _ready() -> void:
	if OS.has_feature("web") and bool(JavaScriptBridge.eval("new URLSearchParams(window.location.search).has('character-lab')")):
		set_process(false)
		set_process_unhandled_input(false)
		set_process_unhandled_key_input(false)
		_open_character_lab.call_deferred()
		return
	terrain = TerrainView.new()
	camera = Camera2D.new()
	overlay = PanelContainer.new()
	overlay_layer = CanvasLayer.new()
	selection = SelectionController.new()
	character_layer = Node2D.new()
	rng.randomize()
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(terrain)
	character_layer.y_sort_enabled = true
	add_child(character_layer)
	add_child(selection)
	selection.selection_changed.connect(_update_status)
	selection.move_commanded.connect(_update_status)
	camera.position_smoothing_enabled = false
	add_child(camera)
	_build_interface()
	get_viewport().size_changed.connect(_resize_world)
	show_seed(42)
	_resize_world.call_deferred()
	for argument in OS.get_cmdline_user_args():
		if argument.begins_with("--preview-output="):
			_capture_preview.call_deferred(argument.trim_prefix("--preview-output="))


func _open_character_lab() -> void:
	var error := get_tree().change_scene_to_file("res://character_lab.tscn")
	if error != OK:
		push_error("Could not open the character playground: %s" % error_string(error))


func show_seed(value: int) -> bool:
	var candidate := generator.generate(value)
	if candidate.is_empty():
		status_label.text = "Could not generate an island. Press R to try again."
		return false
	world = candidate
	terrain.set_world(world)
	selection.clear()
	navigation.set_world(world)
	var character := Character.new()
	character.navigation = navigation
	character.position = navigation.spawn_position()
	character_layer.add_child(character)
	selection.add_character(character)
	zoom_factor = 1.0
	_update_status()
	seed_label.text = "Seed %06d  ·  Press R to refresh" % value
	_resize_world()
	return true


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseButton and event.pressed:
		if event.button_index == MOUSE_BUTTON_LEFT:
			var point: Vector2 = get_viewport().get_canvas_transform().affine_inverse() * event.position
			selection.click(point, camera.zoom.x)
			get_viewport().set_input_as_handled()
		elif event.button_index == MOUSE_BUTTON_WHEEL_UP:
			_change_zoom(1.5)
			get_viewport().set_input_as_handled()
		elif event.button_index == MOUSE_BUTTON_WHEEL_DOWN:
			_change_zoom(1.0 / 1.5)
			get_viewport().set_input_as_handled()


func _process(_delta: float) -> void:
	if zoom_factor > 1.0 and not selection.characters.is_empty():
		var subject: Character = selection.selected[0] if not selection.selected.is_empty() else selection.characters[0]
		camera.position = subject.position
		camera.force_update_scroll()
		_update_ocean()


func _change_zoom(multiplier: float) -> void:
	zoom_factor = clampf(zoom_factor * multiplier, 1.0, 8.0)
	_resize_world()


func _fit_world() -> void:
	zoom_factor = 1.0
	_resize_world()


func _update_status() -> void:
	status_label.text = "Click ground to move" if not selection.selected.is_empty() else "Click character to select"


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
	base_zoom = zoom_level
	camera.zoom = Vector2.ONE * zoom_level * zoom_factor
	camera.position = bounds.get_center()
	# Center the island without hiding it under the HUD, on exact screen pixels.
	var screen_center := fit_rect.get_center().floor()
	camera.offset = (view_size * 0.5 - screen_center) / camera.zoom.x
	if zoom_factor > 1.0 and not selection.characters.is_empty():
		var subject: Character = selection.selected[0] if not selection.selected.is_empty() else selection.characters[0]
		camera.position = subject.position
	camera.force_update_scroll()
	zoom_in.disabled = zoom_factor >= 8.0
	zoom_out.disabled = zoom_factor <= 1.0
	fit_button.disabled = zoom_factor <= 1.0
	_update_ocean()


func _update_ocean() -> void:
	var view_size := get_viewport_rect().size
	var visible := Rect2(
		camera.position + camera.offset - view_size / camera.zoom * 0.5,
		view_size / camera.zoom
	)
	terrain.set_ocean_rect(visible)


func _fit_zoom(bounds: Rect2, area: Rect2) -> float:
	var fit := minf(area.size.x / bounds.size.x, area.size.y / bounds.size.y)
	return floorf(fit) if fit >= 1.0 else 1.0 / ceilf(1.0 / maxf(fit, 0.01))


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
	var controls := HBoxContainer.new()
	controls.add_theme_constant_override("separation", 4)
	content.add_child(controls)
	zoom_out = _zoom_button("-", "Zoom out", func(): _change_zoom(1.0 / 1.5))
	zoom_in = _zoom_button("+", "Zoom in and follow character", func(): _change_zoom(1.5))
	fit_button = _zoom_button("Fit", "Show the whole island", _fit_world)
	controls.add_child(zoom_out)
	controls.add_child(zoom_in)
	controls.add_child(fit_button)
	overlay.minimum_size_changed.connect(_resize_world)


func _zoom_button(text: String, description: String, action: Callable) -> Button:
	var button := Button.new()
	button.text = text
	button.tooltip_text = description
	button.custom_minimum_size = Vector2(32, 28)
	button.pressed.connect(action)
	return button


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
