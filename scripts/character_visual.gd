extends Node2D

const HOP_DISTANCE := 9.0
const HOP_HEIGHT := 2.0
const MARKER_CLEARANCE := 15.0
const INK := Color("#293c34")
const CREAM := Color("#f3e8cd")
const SHADE := Color("#c5cfb6")
const SAGE := Color("#a6bd9b")
const EAR_INNER := Color("#d7bca8")

enum PartKind { HEAD, TORSO, EAR, FOOT, ARM }


class Part extends Node2D:
	var kind: PartKind
	var blink := false

	func _init(value: PartKind) -> void:
		kind = value

	func bounds() -> Rect2:
		match kind:
			PartKind.HEAD:
				return Rect2(-3.0, -2.5, 6.0, 4.75)
			PartKind.TORSO:
				return Rect2(-1.75, -2.8, 3.5, 2.9)
			PartKind.EAR:
				return Rect2(-0.65, -3.3, 1.3, 3.8)
			PartKind.FOOT:
				return Rect2(-0.7, -0.5, 1.4, 0.85)
			PartKind.ARM:
				return Rect2(-0.45, -0.8, 0.9, 1.6)
		return Rect2()

	func _draw() -> void:
		match kind:
			PartKind.HEAD:
				_polygon(PackedVector2Array([
					Vector2(-2, -2.5), Vector2(1.5, -2.5), Vector2(1.5, -2),
					Vector2(2.5, -2), Vector2(2.5, -1), Vector2(3, -1),
					Vector2(3, 1), Vector2(2.25, 1), Vector2(2.25, 1.75),
					Vector2(1.25, 1.75), Vector2(1.25, 2.25), Vector2(-1.5, 2.25),
					Vector2(-1.5, 1.75), Vector2(-2.5, 1.75), Vector2(-2.5, 1),
					Vector2(-3, 1), Vector2(-3, -1), Vector2(-2.5, -1),
					Vector2(-2.5, -2), Vector2(-2, -2),
				]), CREAM)
				draw_rect(Rect2(-1.5, 1.45, 2.75, 0.55), SHADE)
				var eye_height := 0.15 if blink else 0.65
				draw_rect(Rect2(-1.5, -0.15, 0.45, eye_height), INK)
				draw_rect(Rect2(1.05, -0.15, 0.45, eye_height), INK)
				draw_rect(Rect2(-0.2, 0.8, 0.4, 0.3), INK)
			PartKind.TORSO:
				_polygon(PackedVector2Array([
					Vector2(-1, -2.8), Vector2(1, -2.8), Vector2(1, -2.4),
					Vector2(1.75, -2.4), Vector2(1.75, -0.5), Vector2(1, -0.5),
					Vector2(1, 0.1), Vector2(-1, 0.1), Vector2(-1, -0.5),
					Vector2(-1.75, -0.5), Vector2(-1.75, -2.4), Vector2(-1, -2.4),
				]), SAGE)
				draw_rect(Rect2(-0.8, -2.1, 1.6, 1.45), CREAM)
			PartKind.EAR:
				_polygon(PackedVector2Array([
					Vector2(-0.65, 0.5), Vector2(-0.65, -2.7), Vector2(-0.35, -2.7),
					Vector2(-0.35, -3.3), Vector2(0.35, -3.3), Vector2(0.35, -2.7),
					Vector2(0.65, -2.7), Vector2(0.65, 0.5),
				]), CREAM)
				draw_rect(Rect2(-0.23, -2.6, 0.46, 2.4), EAR_INNER)
			PartKind.FOOT:
				_polygon(PackedVector2Array([
					Vector2(-0.7, -0.5), Vector2(0.45, -0.5), Vector2(0.45, -0.15),
					Vector2(0.7, -0.15), Vector2(0.7, 0.35), Vector2(-0.7, 0.35),
				]), CREAM)
			PartKind.ARM:
				_polygon(PackedVector2Array([
					Vector2(-0.45, -0.8), Vector2(0.45, -0.8),
					Vector2(0.45, 0.8), Vector2(-0.45, 0.8),
				]), CREAM)

	func _polygon(points: PackedVector2Array, color: Color) -> void:
		draw_colored_polygon(points, color)
		points.append(points[0])
		draw_polyline(points, INK, 0.4)


var body := Node2D.new()
var head := Part.new(PartKind.HEAD)
var torso := Part.new(PartKind.TORSO)
var left_ear := Part.new(PartKind.EAR)
var right_ear := Part.new(PartKind.EAR)
var left_foot := Part.new(PartKind.FOOT)
var right_foot := Part.new(PartKind.FOOT)
var left_arm := Part.new(PartKind.ARM)
var right_arm := Part.new(PartKind.ARM)
var animation_time := 0.0
var gait_distance := 0.0
var motion_weight := 0.0
var facing := 0.0
var hop_height := 0.0
var visual_bounds := Rect2()
var parts: Array[Part] = []


func _init() -> void:
	add_child(body)
	parts = [left_foot, right_foot, left_arm, right_arm, torso, head, left_ear, right_ear]
	for part in [left_foot, right_foot, left_arm, right_arm, torso, head]:
		body.add_child(part)
	head.add_child(left_ear)
	head.add_child(right_ear)
	left_ear.show_behind_parent = true
	right_ear.show_behind_parent = true
	_pose()


func advance(delta: float, distance: float, direction: Vector2, moving: bool) -> void:
	animation_time += delta
	gait_distance += distance
	var blend := 1.0 - exp(-delta * 16.0)
	motion_weight = lerpf(motion_weight, 1.0 if moving or distance > 0.0 else 0.0, blend)
	facing = lerpf(facing, direction.x if moving else 0.0, blend)
	_pose()
	queue_redraw()


func get_visual_bounds() -> Rect2:
	return visual_bounds


func _pose() -> void:
	var phase := fposmod(gait_distance / HOP_DISTANCE, 1.0)
	var airborne := sin(PI * phase)
	var contact := pow(1.0 - airborne, 3.0) * motion_weight
	hop_height = airborne * HOP_HEIGHT * motion_weight
	var stride := sin(gait_distance / HOP_DISTANCE * PI) * motion_weight
	body.position = Vector2(0, -hop_height)
	body.scale = Vector2(
		1.0 + contact * 0.13 - airborne * motion_weight * 0.035,
		1.0 - contact * 0.12 + airborne * motion_weight * 0.045
	)
	body.rotation = facing * 0.045 * motion_weight
	torso.position = Vector2(0, -0.9)
	torso.scale.y = 1.0 + sin(animation_time * 2.2) * 0.012 * (1.0 - motion_weight)
	left_foot.position = Vector2(-0.95 - stride * 0.12, -maxf(0, stride) * 0.3)
	right_foot.position = Vector2(0.95 - stride * 0.12, -maxf(0, -stride) * 0.3)
	left_arm.position = Vector2(-1.8, -2.2)
	right_arm.position = Vector2(1.8, -2.2)
	left_arm.rotation = stride * 0.2
	right_arm.rotation = -stride * 0.2
	head.position = Vector2(-facing * 0.08, -5.65 + sin(TAU * phase - 0.4) * 0.16 * motion_weight)
	head.rotation = -facing * 0.025
	left_ear.position = Vector2(-1.25, -2.0)
	right_ear.position = Vector2(1.15, -2.0)
	right_ear.scale = Vector2(1, 0.86)
	var ear_sway := sin(TAU * phase - 0.9) * 0.15 * motion_weight
	left_ear.rotation = -0.08 + ear_sway
	right_ear.rotation = 0.12 + ear_sway * 0.8
	var blink := fmod(animation_time, 4.7) > 4.56
	if head.blink != blink:
		head.blink = blink
		head.queue_redraw()
	visual_bounds = Rect2()
	for part in parts:
		var bounds := part.get_relative_transform_to_parent(self) * part.bounds().grow(0.2)
		visual_bounds = bounds if visual_bounds.size == Vector2.ZERO else visual_bounds.merge(bounds)


func _draw() -> void:
	var lift := hop_height / HOP_HEIGHT
	draw_set_transform(Vector2(0, 0.2), 0, Vector2(1.0 - lift * 0.18, 0.36 - lift * 0.04))
	draw_circle(Vector2.ZERO, 2.35, Color(0.12, 0.21, 0.16, 0.27 - lift * 0.09))
	draw_set_transform(Vector2.ZERO)
