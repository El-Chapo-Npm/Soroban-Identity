# GetQuota200ResponseMonthly


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**limit** | **int** |  | [optional] 
**used** | **int** |  | [optional] 
**remaining** | **int** |  | [optional] 
**reset_at** | **int** | Unix seconds, 1st of next UTC month | [optional] 

## Example

```python
from soroban_identity_client.models.get_quota200_response_monthly import GetQuota200ResponseMonthly

# TODO update the JSON string below
json = "{}"
# create an instance of GetQuota200ResponseMonthly from a JSON string
get_quota200_response_monthly_instance = GetQuota200ResponseMonthly.from_json(json)
# print the JSON string representation of the object
print(GetQuota200ResponseMonthly.to_json())

# convert the object into a dict
get_quota200_response_monthly_dict = get_quota200_response_monthly_instance.to_dict()
# create an instance of GetQuota200ResponseMonthly from a dict
get_quota200_response_monthly_from_dict = GetQuota200ResponseMonthly.from_dict(get_quota200_response_monthly_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


