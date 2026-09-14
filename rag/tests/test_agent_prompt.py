from app.agent import prompt as prompt_module


def build_system_prompt(servings: int) -> str:
    assert hasattr(prompt_module, "build_system_prompt"), "dynamic prompt builder is missing"
    return prompt_module.build_system_prompt(servings)


def test_default_prompt_requests_one_adult_portion():
    prompt = build_system_prompt(1)

    assert "Every meal is for 1 adult" in prompt
    assert "already scaled for 1 adult" in prompt


def test_multi_serving_prompt_requires_all_quantities_to_be_scaled_once():
    prompt = build_system_prompt(6)

    assert "Every meal is for 6 adults" in prompt
    assert "every meal and every dish serves all 6 adults" in prompt
    assert "already scaled for all 6 adults" in prompt
    assert "Scale both servingsUsed and amountUsed exactly once" in prompt
    assert "Do not output per-person amounts" in prompt
    assert "Do not multiply quantities a second time" in prompt
    assert "no greater than 60,000" in prompt
    assert "servingsUsed is between 0.05 and 120.0" in prompt
