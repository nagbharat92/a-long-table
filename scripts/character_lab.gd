extends Control

const Appearance := preload("res://scripts/character_visual.gd")
const Character := preload("res://scripts/character.gd")
const Navigation := preload("res://scripts/world_navigation.gd")

var appearance := Appearance.new()
var mode := 1
var buttons: Array[Button] = []
var ui := CanvasLayer.new()
var heading := VBoxContainer.new()
var footer := Label.new()


func _ready() -> void:
	add_child(appearance)
	add_child(ui)
	var ui_theme := Theme.new()
	var font := SystemFont.new()
	font.font_names = PackedStringArray(["Arial", "Helvetica Neue"])
	ui_theme.default_font = font
	ui_theme.default_font_size = 14
	heading.theme = ui_theme
	heading.add_theme_constant_override("separation", 10)
	ui.add_child(heading)
	var title := Label.new()
	title.text = "Character playground"
	title.add_theme_font_size_override("font_size", 22)
	title.add_theme_color_override("font_color", Appearance.INK)
	heading.add_child(title)
	var controls := HBoxContainer.new()
	controls.add_theme_constant_override("separation", 4)
	heading.add_child(controls)
	var group := ButtonGroup.new()
	for index in range(3):
		var button := Button.new()
		button.text = ["Idle", "Hop", "Shallows"][index]
		button.toggle_mode = true
		button.button_group = group
		button.custom_minimum_size = Vector2(60, 34)
		button.add_theme_stylebox_override("normal", _button_style(Color("#d1ddcb")))
		button.add_theme_stylebox_override("hover", _button_style(Color("#c1d1b9")))
		button.add_theme_stylebox_override("pressed", _button_style(Appearance.INK))
		button.add_theme_stylebox_override("hover_pressed", _button_style(Appearance.INK))
		button.add_theme_color_override("font_color", Appearance.INK)
		button.add_theme_color_override("font_hover_color", Appearance.INK)
		button.add_theme_color_override("font_pressed_color", Appearance.CREAM)
		button.add_theme_color_override("font_hover_pressed_color", Appearance.CREAM)
		button.pressed.connect(set_mode.bind(index))
		buttons.append(button)
		controls.add_child(button)
	var back := Button.new()
	back.text = "Back to island"
	back.flat = true
	back.alignment = HORIZONTAL_ALIGNMENT_LEFT
	for state in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color"]:
		back.add_theme_color_override(state, Appearance.INK)
	back.custom_minimum_size.y = 34
	back.pressed.connect(_back_to_island)
	heading.add_child(back)
	footer.theme = ui_theme
	footer.text = "Same character and motion as the island."
	footer.add_theme_color_override("font_color", Color("#536650"))
	ui.add_child(footer)
	get_viewport().size_changed.connect(_layout)
	set_mode(1)
	_layout()


func set_mode(value: int) -> void:
	mode = value
	for index in range(buttons.size()):
		buttons[index].set_pressed_no_signal(index == value)


func _button_style(color: Color) -> StyleBoxFlat:
	var style := StyleBoxFlat.new()
	style.bg_color = color
	style.set_corner_radius_all(3)
	style.content_margin_left = 10
	style.content_margin_right = 10
	return style


func _process(delta: float) -> void:
	var speed := Character.MOVE_SPEED if mode == 1 else Character.MOVE_SPEED * Navigation.SHALLOW_SPEED
	if mode == 0:
		speed = 0.0
	appearance.advance(delta, speed * delta, Vector2.RIGHT, speed > 0.0)


func _layout() -> void:
	var view := get_viewport_rect().size
	var density := 1.0
	if OS.has_feature("web"):
		density = maxf(1.0, float(JavaScriptBridge.eval("window.devicePixelRatio")))
	ui.scale = Vector2.ONE * density
	heading.position = Vector2(20, 18)
	heading.size = heading.get_combined_minimum_size()
	footer.position = Vector2(20, view.y / density - 36)
	footer.size.x = maxf(1.0, view.x / density - 40)
	footer.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	var top := (heading.position.y + heading.size.y + 24.0) * density
	var bottom := footer.position.y * density - 12.0 * density
	var area := Rect2(20.0 * density, top, maxf(1.0, view.x - 40.0 * density), maxf(1.0, bottom - top))
	var magnification := minf(view.y / 29.0, minf(area.size.x / 12.0, area.size.y / 16.0))
	appearance.scale = Vector2.ONE * magnification
	appearance.position = Vector2(area.get_center().x, area.get_center().y + 5.5 * magnification)
	queue_redraw()


func _draw() -> void:
	draw_rect(get_viewport_rect(), Color("#e6ece3"))


func _back_to_island() -> void:
	if OS.has_feature("web"):
		JavaScriptBridge.eval("window.location.search = ''")
	else:
		var error := get_tree().change_scene_to_file("res://main.tscn")
		if error != OK:
			push_error("Could not open the island: %s" % error_string(error))
