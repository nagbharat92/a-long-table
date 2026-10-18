extends Node

const Character := preload("res://scripts/character.gd")

signal selection_changed
signal move_commanded

var characters: Array[Character] = []
var selected: Array[Character] = []


func clear() -> void:
	for character in characters:
		character.set_process(false)
		character.hide()
		character.queue_free()
	characters.clear()
	selected.clear()
	selection_changed.emit()


func add_character(character: Character) -> void:
	characters.append(character)


func select(character: Character) -> void:
	var next: Array[Character] = []
	if character != null:
		next.append(character)
	select_characters(next)


func select_characters(next: Array[Character]) -> void:
	for previous in selected:
		previous.selected = false
		previous.queue_redraw()
	selected.clear()
	for character in next:
		if not characters.has(character) or selected.has(character):
			continue
		selected.append(character)
		character.selected = true
		character.queue_redraw()
	selection_changed.emit()


func click(point: Vector2, zoom: float) -> void:
	var closest: Character = null
	var best := INF
	for character in characters:
		var distance := (character.position + Vector2(0, -4)).distance_to(point)
		if character.hit_test(point, zoom) and distance < best:
			closest = character
			best = distance
	if closest != null:
		select(closest)
		return
	if selected.is_empty():
		return
	for character in selected:
		character.move_to(point)
	move_commanded.emit()
