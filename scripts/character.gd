extends Node2D

const Navigation := preload("res://scripts/world_navigation.gd")
const Appearance := preload("res://scripts/character_visual.gd")
const MOVE_SPEED := 22.0
const MARKER := Color("#ffe6a0")

var navigation: Navigation
var selected := false
var route := PackedVector2Array()
var route_index := 0
var appearance := Appearance.new()
var movement_direction := Vector2.ZERO


func _init() -> void:
	add_child(appearance)


func move_to(destination: Vector2) -> void:
	route = navigation.route(position, destination)
	route_index = 1
	queue_redraw()


func is_moving() -> bool:
	return route_index < route.size()


func advance(delta: float) -> void:
	var remaining := delta
	var travelled := 0.0
	while is_moving() and remaining > 0.0:
		var distance := position.distance_to(route[route_index])
		if distance < 0.001:
			position = route[route_index]
			route_index += 1
			continue
		# Small integration steps apply the water slowdown at terrain boundaries.
		var step_time := minf(remaining, 0.01)
		var speed := MOVE_SPEED * navigation.speed_at(position)
		if speed <= 0.0:
			push_error("Character reached blocked terrain.")
			route = PackedVector2Array()
			break
		var travel := minf(distance, speed * step_time)
		movement_direction = position.direction_to(route[route_index])
		position = position.move_toward(route[route_index], travel)
		travelled += travel
		remaining -= travel / speed
		if travel >= distance:
			route_index += 1
	if not is_moving():
		route = PackedVector2Array()
		route_index = 0
	appearance.advance(delta, travelled, movement_direction, is_moving())


func _process(delta: float) -> void:
	advance(delta)
	queue_redraw()


func _draw() -> void:
	var shadow := Color("#20363066")
	draw_set_transform(-position)
	if is_moving():
		var start := position
		var spacing := 0.0
		for index in range(route_index, route.size()):
			var end := route[index]
			var length := start.distance_to(end)
			while spacing < length:
				var dot := start.lerp(end, spacing / length)
				draw_circle(dot + Vector2(0, 0.35), 0.65, shadow)
				draw_circle(dot, 0.45, Color("#fff1cbd9"))
				spacing += 3.5
			spacing -= length
			start = end
		draw_arc(route[-1], 1.5, 0, TAU, 12, MARKER, 0.5)
	draw_set_transform(Vector2.ZERO)
	if selected:
		draw_arc(Vector2.ZERO, 3.0, 0, TAU, 20, Color("#ffe6a0b3"), 0.5)
	var ink := Color("#23312e")
	var zoom := get_global_transform_with_canvas().get_scale().x
	var marker_radius := maxf(1.5, 3.0 / zoom)
	var marker_y := marker_position(zoom).y
	var marker := PackedVector2Array([
		Vector2(0, marker_y + marker_radius), Vector2(-marker_radius, marker_y),
		Vector2(0, marker_y - marker_radius), Vector2(marker_radius, marker_y),
	])
	draw_colored_polygon(marker, MARKER)
	marker.append(marker[0])
	draw_polyline(marker, ink, maxf(0.25, 0.65 / zoom))


func marker_position(zoom: float) -> Vector2:
	var radius := maxf(1.5, 3.0 / zoom)
	return Vector2(0, -Appearance.MARKER_CLEARANCE - radius - 2.0 / zoom + sin(appearance.animation_time * 2.5) * 0.45)


func hit_test(point: Vector2, zoom: float) -> bool:
	var local := point - position
	var bounds := appearance.get_visual_bounds().grow(0.5)
	var radius := maxf(1.5, 3.0 / zoom)
	var marker := Rect2(marker_position(zoom) - Vector2.ONE * radius, Vector2.ONE * radius * 2.0)
	bounds = bounds.merge(marker.grow(0.5))
	var hit_size := bounds.size.max(Vector2.ONE * 24.0 / zoom)
	return Rect2(bounds.get_center() - hit_size * 0.5, hit_size).has_point(local)
